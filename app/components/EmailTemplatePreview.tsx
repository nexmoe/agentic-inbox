import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import { extractDomainFromAddress, renderEmailTemplate } from "../../shared/email-template";

interface EmailTemplatePreviewProps {
	subject: string;
	bodyHtml: string;
	senderName?: string;
	senderEmail?: string;
	trackOpens: boolean;
	trackingAvailable: boolean;
}

const PREVIEW_SANITIZE_OPTIONS = {
	USE_PROFILES: { html: true },
	FORBID_TAGS: ["style", "base", "link", "meta", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "video", "audio", "source", "track"],
	FORBID_ATTR: ["ping", "download", "srcset", "sizes", "background", "poster", "action", "formaction", "autofocus"],
	ADD_ATTR: ["target", "referrerpolicy"],
};

export default function EmailTemplatePreview({
	subject,
	bodyHtml,
	senderName,
	senderEmail,
	trackOpens,
	trackingAvailable,
}: EmailTemplatePreviewProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(220);
	const [frameDocument, setFrameDocument] = useState("");
	const [nonce] = useState(() => crypto.randomUUID().replaceAll("-", ""));

	const effectiveSenderEmail = senderEmail?.trim() || "team@example.com";
	const domain = extractDomainFromAddress(effectiveSenderEmail) || "example.com";
	const tracked = trackingAvailable && trackOpens;

	const handleMessage = useCallback((event: MessageEvent) => {
		if (event.source !== iframeRef.current?.contentWindow) return;
		if (
			event.data
			&& typeof event.data === "object"
			&& event.data.__templatePreviewHeight
			&& typeof event.data.height === "number"
			&& event.data.height > 0
		) {
			setHeight(event.data.height);
		}
	}, []);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const sanitizedBody = DOMPurify.sanitize(bodyHtml || "", PREVIEW_SANITIZE_OPTIONS);
		const origin = window.location.origin;
		const logoUrl = tracked
			? `${origin}/mail-signatures/preview/${encodeURIComponent(domain)}.png`
			: undefined;

		const templateHtml = renderEmailTemplate({
			subject,
			senderName,
			senderEmail: effectiveSenderEmail,
			bodyHtml: sanitizedBody,
			trackOpens: tracked,
			logoUrl,
			emptyPlaceholder: "Write your message…",
		});

		const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src ${origin} data: https: http:; script-src 'nonce-${nonce}';">
<style>
* { box-sizing: border-box; }
html { background: transparent; color-scheme: light; }
body {
	margin: 0;
	padding: 0;
	background: transparent;
	font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif;
	overflow: hidden;
	word-wrap: break-word;
	overflow-wrap: break-word;
}
a { color: #0066cc; text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; }
p { margin: 0 0 18px 0; }
p:last-child { margin-bottom: 0; }
blockquote {
	border-left: 2px solid #dedbd6;
	padding-left: 14px;
	margin-left: 0;
	color: #6e6e73;
}
</style>
</head>
<body>${templateHtml}<script nonce="${nonce}">
function reportHeight() {
	var h = document.body.scrollHeight;
	if (h > 0) parent.postMessage({ __templatePreviewHeight: true, height: h }, "*");
}
reportHeight();
new ResizeObserver(reportHeight).observe(document.body);
</script></body>
</html>`;

		setFrameDocument(html);
	}, [subject, bodyHtml, senderName, effectiveSenderEmail, domain, tracked, nonce]);

	return (
		<div data-template-preview data-track-state={tracked ? "tracked" : "untracked"} className="h-full min-h-[260px] rounded-lg border border-kumo-line overflow-hidden bg-transparent">
			{frameDocument && (
				<iframe
					ref={iframeRef}
					srcDoc={frameDocument}
					className="block w-full border-0 bg-transparent"
					style={{ height: `${Math.max(height, 260)}px` }}
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					title="Email template preview"
				/>
			)}
		</div>
	);
}
