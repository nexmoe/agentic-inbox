import { ArrowRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import { getSenderDetails } from "~/lib/sender";

export default function MailAddressLine({ sender, recipient, unread, renderAddress = (address) => address }: {
	sender: string;
	recipient: string;
	unread: boolean;
	renderAddress?: (address: string) => ReactNode;
}) {
	const senderAddress = getSenderDetails(sender).address || "未知发件人";
	const recipientAddress = recipient?.trim();

	return (
		<span data-mail-addresses className={`flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap ${typeClass("body")}`}>
			<span data-mail-sender title={senderAddress} aria-label={`发件人：${senderAddress}`} className={`min-w-0 truncate ${unread ? "text-kumo-default" : "text-kumo-strong"}`} style={{ fontVariationSettings: unread ? fontWeights.semibold : fontWeights.normal }}>
				{renderAddress(senderAddress)}
			</span>
			{recipientAddress && <>
				<ArrowRightIcon size={12} aria-hidden="true" className="shrink-0 text-kumo-subtle" />
				<span data-mail-recipient title={recipientAddress} aria-label={`收件人：${recipientAddress}`} className="min-w-0 truncate text-kumo-brand">
					{renderAddress(recipientAddress)}
				</span>
			</>}
		</span>
	);
}
