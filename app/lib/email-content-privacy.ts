import DOMPurify from "dompurify";
import { cleanEmailLink } from "shared/email-link-privacy";

const SANITIZE_OPTIONS = {
	USE_PROFILES: { html: true },
	FORBID_TAGS: ["style", "base", "link", "meta", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "video", "audio", "source", "track"],
	FORBID_ATTR: ["ping", "download", "srcset", "sizes", "background", "poster", "action", "formaction", "autofocus"],
	ADD_ATTR: ["target", "referrerpolicy"],
};

// Keep email formatting, excluding CSS properties that can fetch resources.
const SAFE_STYLE = /^(?:color|background-color|font(?:-family|-size|-weight|-style|-variant)?|line-height|letter-spacing|word-spacing|text-(?:align|decoration|indent|transform)|white-space|word-break|overflow-wrap|vertical-align|display|visibility|opacity|(?:min-|max-)?(?:width|height)|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?|border-collapse|border-spacing|border-radius|table-layout|list-style-type|list-style-position|float|clear|overflow(?:-x|-y)?)$/;

export interface EmailPrivacyReport {
	trackersBlocked: number;
	imagesBlocked: number;
	remoteImages: number;
	linksCleaned: number;
	remoteContentBlocked: boolean;
}

function hiddenImage(image: Element): boolean {
	for (let node: Element | null = image; node; node = node.parentElement) {
		const style = (node as HTMLElement).style;
		if (node.hasAttribute("hidden") || style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0") return true;
	}
	const style = (image as HTMLElement).style;
	const dimension = (name: "width" | "height") => {
		const value = style[name] || image.getAttribute(name) || "";
		return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? Number.parseFloat(value) : undefined;
	};
	const width = dimension("width"), height = dimension("height");
	return width === 0 || height === 0 || (width !== undefined && height !== undefined && width <= 2 && height <= 2);
}

function trackingEndpoint(url: URL): boolean {
	return /(?:^|\.)(?:mailtrack\.io|sidekickopen\.com)$/.test(url.hostname)
		|| /\/(?:track\/open|wf\/open|(?:pixel|beacon|open)(?:\.(?:gif|png|php|aspx?))?)(?:\/|$)/i.test(url.pathname);
}

/** All parsing happens in an inert template; no sender resources load here. */
export function protectEmailContent(body: string, options: {
	origin: string;
	inlineImages: Readonly<Record<string, string>>;
	allowRemoteImages: boolean;
}): { html: string; report: EmailPrivacyReport } {
	const template = document.createElement("template");
	template.innerHTML = body;
	const fragment = DOMPurify.sanitize(template.content, { ...SANITIZE_OPTIONS, RETURN_DOM_FRAGMENT: true });
	const inlineImages = new Map(Object.entries(options.inlineImages).map(([url, data]) => [new URL(url, options.origin).href, data]));
	const report: EmailPrivacyReport = { trackersBlocked: 0, imagesBlocked: 0, remoteImages: 0, linksCleaned: 0, remoteContentBlocked: false };

	for (const image of fragment.querySelectorAll("img")) {
		const src = image.getAttribute("src") ?? "";
		let url: URL | undefined;
		try { url = new URL(src, options.origin); } catch { /* Unusable image. */ }
		if (url && inlineImages.has(url.href)) {
			image.setAttribute("src", inlineImages.get(url.href)!);
		} else if (/^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);/i.test(src)) {
			// Embedded image bytes never contact the sender, including spacer pixels.
		} else {
			const remote = url && /^https?:$/.test(url.protocol) && /^(?:https?:)?\/\//i.test(src);
			if (url && remote && (hiddenImage(image) || trackingEndpoint(url))) {
				report.trackersBlocked++;
				image.remove();
				continue;
			}
			if (remote) report.remoteImages++;
			if (url && remote && options.allowRemoteImages && url.protocol === "https:") image.setAttribute("src", url.href);
			else {
				if (remote) report.imagesBlocked++;
				const placeholder = document.createElement("span");
				placeholder.textContent = image.getAttribute("alt")?.trim() || "Image blocked";
				image.replaceWith(placeholder);
				continue;
			}
		}
		image.setAttribute("referrerpolicy", "no-referrer");
	}

	for (const link of fragment.querySelectorAll("a[href], area[href]")) {
		const href = (link.getAttribute("href") ?? "").trim();
		let url: URL | undefined;
		try { url = new URL(href, options.origin); } catch { /* Not a usable destination. */ }
		const absoluteWeb = /^(?:https?:)?\/\//i.test(href) && url && /^https?:$/.test(url.protocol) && !url.username && !url.password;
		const localAttachment = url && inlineImages.has(url.href);
		if (!/[\u0000-\u0020\u007f]/.test(href) && url && (absoluteWeb || localAttachment || /^(?:mailto|tel|sms):$/i.test(url.protocol))) {
			const clean = cleanEmailLink(absoluteWeb ? (href.startsWith("//") ? url.href : href) : url.href);
			if (clean !== (href.startsWith("//") ? url.href : href) && absoluteWeb) report.linksCleaned++;
			link.setAttribute("href", clean);
			link.setAttribute("target", "_blank");
			link.setAttribute("rel", "noopener noreferrer");
			link.setAttribute("referrerpolicy", "no-referrer");
		} else link.removeAttribute("href");
	}

	for (const element of fragment.querySelectorAll<HTMLElement>("[style]")) {
		for (const property of Array.from(element.style)) {
			if (!SAFE_STYLE.test(property)) {
				if (/(?:url|image-set)\s*\(/i.test(element.style.getPropertyValue(property))) report.remoteContentBlocked = true;
				element.style.removeProperty(property);
			}
		}
	}
	const container = document.createElement("template");
	container.content.append(fragment);
	return { html: container.innerHTML, report };
}
