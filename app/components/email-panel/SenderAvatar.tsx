import { useState } from "react";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import { getSenderDetails } from "~/lib/sender";

export default function SenderAvatar({ sender, variant = "default", className = "" }: {
	sender: string;
	variant?: "default" | "self" | "draft";
	className?: string;
}) {
	const { label, domain } = getSenderDetails(sender);
	const src = domain && variant !== "draft"
		? `https://a.favicon.im/${domain}?larger=true&throw-error-on-404=true`
		: undefined;
	const [loadedSrc, setLoadedSrc] = useState<string>();
	const [failedSrc, setFailedSrc] = useState<string>();

	return (
		<div aria-hidden="true" data-sender-avatar data-sender-domain={domain} className={`relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-kumo-line ${typeClass("caption")} ${variant === "self" ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill text-foreground"} ${className}`} style={{ fontVariationSettings: fontWeights.semibold }}>
			{variant === "draft" ? "D" : label.charAt(0).toUpperCase()}
			{src && failedSrc !== src && (
				<img key={src} src={src} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`absolute inset-0 h-full w-full bg-kumo-base object-contain p-1.5 ${loadedSrc === src ? "" : "opacity-0"}`} onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)} />
			)}
		</div>
	);
}
