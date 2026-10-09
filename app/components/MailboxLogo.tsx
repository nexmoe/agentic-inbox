import { EnvelopeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { IconComponentProps } from "@/lib/icon-context";
import { getSenderDetails } from "~/lib/sender";

export default function MailboxLogo({ email, size = 16, strokeWidth = 1.5, className = "" }: IconComponentProps & { email: string }) {
	const { domain } = getSenderDetails(email);
	const src = domain ? `https://a.favicon.im/${domain}?larger=true&throw-error-on-404=true` : undefined;
	const [loadedSrc, setLoadedSrc] = useState<string>();
	const [failedSrc, setFailedSrc] = useState<string>();

	return (
		<span aria-hidden="true" data-mailbox-logo data-mailbox-domain={domain} className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-kumo-line bg-kumo-base ${className}`} style={{ width: size, height: size }}>
			<EnvelopeIcon size={Math.max(0, size - 2)} strokeWidth={strokeWidth} />
			{src && failedSrc !== src && <img key={src} src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`absolute inset-0 h-full w-full bg-kumo-base object-contain ${loadedSrc === src ? "" : "opacity-0"}`} onLoad={() => setLoadedSrc(src)} onError={() => setFailedSrc(src)} />}
		</span>
	);
}
