import { Button } from "@cloudflare/kumo";
import { ArrowUpRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useState } from "react";
import { isSummaryLinkUrl, type EmailSummaryCode, type EmailSummaryDetails } from "../../../shared/email-summary";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import { cleanEmailLink } from "shared/email-link-privacy";

/** Only emphasis is supported. Email or model HTML and Markdown links stay inert text. */
function KeyPoint({ text }: { text: string }) {
	return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith("**") && part.endsWith("**")
		? <strong key={index} style={{ fontVariationSettings: fontWeights.semibold }}>{part.slice(2, -2)}</strong>
		: <Fragment key={index}>{part}</Fragment>);
}

function VerificationCode({ code }: { code: EmailSummaryCode }) {
	const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
	useEffect(() => {
		if (status === "idle") return;
		const timer = setTimeout(() => setStatus("idle"), 2_000);
		return () => clearTimeout(timer);
	}, [status]);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(code.value);
			setStatus("copied");
		} catch {
			setStatus("error");
		}
	};
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-muted px-3 py-2">
			<div className="min-w-0 flex-1">
				<p className={`${typeClass("caption")} break-words text-muted-foreground`}>{code.label}</p>
				<code className={`${typeClass("title")} break-all text-foreground`} style={{ fontVariationSettings: fontWeights.semibold }}>{code.value}</code>
			</div>
			<Button size="sm" variant="ghost" aria-label={status === "copied" ? "Verification code copied" : "Copy verification code"} onClick={() => void copy()} icon={status === "copied" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}>
				<span className="inline-grid" aria-live="polite">
					<span className="invisible col-start-1 row-start-1" aria-hidden="true">Copy failed</span>
					<span className="col-start-1 row-start-1">{status === "copied" ? "Copied" : status === "error" ? "Copy failed" : "Copy"}</span>
				</span>
			</Button>
		</div>
	);
}

export default function SummaryDetails({ details }: { details: EmailSummaryDetails }) {
	const links = details.links.filter((link) => isSummaryLinkUrl(link.url));
	return (
		<div className="space-y-3">
			<ul className={`list-disc space-y-1.5 pl-4 text-foreground ${typeClass("body")}`}>
				{details.points.map((point, index) => <li key={index} className="break-words"><KeyPoint text={point} /></li>)}
			</ul>
			{details.codes.length > 0 && <div className="space-y-1.5">
				<h4 className={`${typeClass("caption")} text-muted-foreground`}>{details.codes.length === 1 ? "Verification code" : "Verification codes"}</h4>
				{details.codes.map((code) => <VerificationCode key={code.value} code={code} />)}
			</div>}
			{(["action", "link"] as const).map((kind) => {
				const items = links.filter((link) => link.kind === kind);
				return items.length > 0 && <div key={kind} className="space-y-1.5">
					<h4 className={`${typeClass("caption")} text-muted-foreground`}>{kind === "action" ? "Actions" : "Links"}</h4>
					<div className="flex flex-wrap gap-x-5 gap-y-2">
						{items.map((link) => <a key={link.url} href={cleanEmailLink(link.url)} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="min-w-0 max-w-full rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
							<span className={`flex items-start gap-1 text-foreground ${typeClass("body")}`} style={{ fontVariationSettings: fontWeights.semibold }}>
								<span className="break-words underline decoration-border underline-offset-4">{link.label}</span><ArrowUpRightIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
							</span>
							<span className={`block break-all text-muted-foreground ${typeClass("caption")}`}>{new URL(link.url).hostname}</span>
						</a>)}
					</div>
				</div>;
			})}
		</div>
	);
}
