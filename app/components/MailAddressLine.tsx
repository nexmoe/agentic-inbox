import { ArrowRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import MailboxLogo from "~/components/MailboxLogo";
import { getSenderDetails } from "~/lib/sender";

export default function MailAddressLine({ sender, recipient, unread, renderAddress = (address) => address }: {
	sender: string;
	recipient: string;
	unread: boolean;
	renderAddress?: (address: string) => ReactNode;
}) {
	const senderAddress = getSenderDetails(sender).address || "Unknown sender";
	const recipientAddress = recipient?.trim();

	return (
		<span data-mail-addresses className={`flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap ${typeClass("body")}`}>
			<span data-mail-sender title={senderAddress} aria-label={`From: ${senderAddress}`} className={`flex min-w-0 items-center gap-1.5 ${unread ? "text-kumo-default" : "text-kumo-strong"}`} style={{ fontVariationSettings: unread ? fontWeights.semibold : fontWeights.normal }}>
				<MailboxLogo email={senderAddress} size={16} />
				<span className="truncate">{renderAddress(senderAddress)}</span>
			</span>
			{recipientAddress && <>
				<ArrowRightIcon size={12} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
				<span data-mail-recipient title={recipientAddress} aria-label={`To: ${recipientAddress}`} className="flex min-w-0 items-center gap-1.5 text-kumo-strong">
					<MailboxLogo email={recipientAddress} size={16} />
					<span className="truncate">{renderAddress(recipientAddress)}</span>
				</span>
			</>}
		</span>
	);
}
