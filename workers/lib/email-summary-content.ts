import { Parser } from "htmlparser2";
import { isSummaryLinkUrl } from "../../shared/email-summary.ts";

interface SourceLink {
	label: string;
	url: string;
}

interface ElementFrame {
	hidden: boolean;
	link?: SourceLink;
}

const hiddenTags = new Set(["script", "style", "head", "template", "noscript"]);
const blockTags = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section"]);
const normalizeText = (value: string) => value.replace(/[^\S\n]+/gu, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

function sourceUrl(value: string): string | undefined {
	const url = value.trim().startsWith("//") ? `https:${value.trim()}` : value.trim();
	return isSummaryLinkUrl(url) ? url : undefined;
}

function trimUrlPunctuation(value: string): string {
	let result = value.replace(/[.,;!?:。，；！：？、]+$/u, "");
	for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
		while (result.endsWith(close) && result.split(close).length > result.split(open).length) result = result.slice(0, -1);
	}
	return result;
}

/** Parse, but never execute or fetch, email HTML. Labels and destinations stay together. */
export function extractSummaryContent(body: string): { text: string; links: SourceLink[] } {
	const frames: ElementFrame[] = [];
	const text: string[] = [];
	const links: SourceLink[] = [];
	const append = (value: string) => {
		const frame = frames.at(-1);
		if (frame?.hidden) return;
		text.push(value);
		if (frame?.link) frame.link.label += value;
	};
	const parser = new Parser({
		onopentag(name, attributes) {
			const parent = frames.at(-1);
			const hidden = !!parent?.hidden || hiddenTags.has(name) || attributes.hidden !== undefined || attributes["aria-hidden"]?.toLowerCase() === "true" || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attributes.style ?? "");
			let link = parent?.link;
			if (!hidden && name === "a" && attributes.href) {
				const url = sourceUrl(attributes.href);
				if (url) {
					link = { url, label: "" };
					links.push(link);
				}
			}
			frames.push({ hidden, link });
			if (name === "br" || blockTags.has(name)) append("\n");
			if (name === "img" && attributes.alt) append(attributes.alt);
			if (!hidden && name === "a" && link && (attributes["aria-label"] || attributes.title)) link.label += `${attributes["aria-label"] || attributes.title} `;
		},
		ontext: append,
		onclosetag(name) {
			if (blockTags.has(name)) append("\n");
			if (name === "a") append(" ");
			frames.pop();
		},
	}, { decodeEntities: true });
	parser.end(body);
	const visibleText = normalizeText(text.join(""));
	for (const match of visibleText.matchAll(/https?:\/\/[^\s<>"'。，；！？、\u0000-\u001f]+/giu)) {
		const url = sourceUrl(trimUrlPunctuation(match[0]));
		if (url) links.push({ url, label: new URL(url).hostname });
	}
	const unique = new Map<string, SourceLink>();
	for (const link of links) {
		const key = new URL(link.url).href;
		const label = normalizeText(link.label).replace(/\s+/g, " ").slice(0, 200) || new URL(link.url).hostname;
		if (!unique.has(key)) unique.set(key, { url: link.url, label });
	}
	return { text: visibleText, links: [...unique.values()] };
}

/** Codes must occur in visible body text, not an attribute, URL token, or attachment name. */
export function codeOccursInBody(value: string, bodies: string[]): boolean {
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
	return bodies.some((body) => pattern.test(body.replace(/https?:\/\/\S+/gi, "")));
}

/** Keep boilerplate footer destinations out of the model's action catalog. */
export function summaryLinksForMessage(links: SourceLink[], subject: string): SourceLink[] {
	const footers = [
		{ label: /unsubscribe|opt[ -]?out|退订|取消订阅/i, path: /unsubscribe|optout|opt-out/i, topic: /unsubscribe|opt[ -]?out|退订|取消订阅/i },
		{ label: /privacy policy|隐私政策/i, path: /\/privacy(?:[./-]|$)/i, topic: /privacy|隐私/i },
		{ label: /terms (?:of (?:service|use)|and conditions)|服务条款/i, path: /\/terms(?:[./-]|$)/i, topic: /terms|条款/i },
		{ label: /^(?:manage (?:email )?preferences|email preferences|通知设置|邮件偏好)$/i, path: /\/preferences(?:[./-]|$)/i, topic: /preferences|通知设置|邮件偏好/i },
		{ label: /^(?:(?:visit|view) )?(?:support|help(?: center)?|帮助中心)$/i, topic: /help|support|ticket|帮助|支持|工单/i },
	];
	return links.filter((link) => !footers.some((footer) => (footer.label.test(link.label) || footer.path?.test(new URL(link.url).pathname)) && !footer.topic.test(subject)));
}
