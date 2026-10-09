// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import { formatDetailDate } from "~/lib/utils";
import { getSenderDetails } from "~/lib/sender";
import SenderAvatar from "~/components/email-panel/SenderAvatar";
import type { Email } from "~/types";

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
	email?: Email;
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
	email,
}: EmailPanelHeaderProps) {
	const { name: senderName, address: senderAddress, label: senderLabel } = getSenderDetails(email?.sender);

	return (
		<header data-mail-message-header className="px-4 py-5 md:px-6" style={{ fontVariationSettings: fontWeights.normal }}>
			<h2 className={`${typeClass("title")} break-words text-foreground`} style={{ fontVariationSettings: fontWeights.semibold }}>{subject}</h2>
			{showThreadCount && (
				<p className={`${typeClass("caption")} mt-1 text-muted-foreground`}>
					{messageCount} messages in this thread
				</p>
			)}
			{email && (
				<div data-mail-message-meta className="mt-4 grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 @[480px]:grid-cols-[32px_minmax(0,1fr)_auto]">
					<SenderAvatar sender={email.sender} className="row-span-2 @[480px]:row-span-1" />
					<div className="min-w-0">
						<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
							<span className={`${typeClass("body")} [overflow-wrap:anywhere] text-foreground`} style={{ fontVariationSettings: fontWeights.semibold }}>{senderLabel}</span>
							{senderName && <span className={`${typeClass("caption")} [overflow-wrap:anywhere] text-muted-foreground`}>{senderAddress}</span>}
						</div>
						<p className={`mt-0.5 [overflow-wrap:anywhere] text-muted-foreground ${typeClass("caption")}`}>To: {email.recipient}</p>
					</div>
					<time dateTime={email.date} className={`${typeClass("caption")} col-start-2 text-muted-foreground @[480px]:col-start-3 @[480px]:row-start-1 @[480px]:whitespace-nowrap`}>
						{formatDetailDate(email.date)}
					</time>
				</div>
			)}
		</header>
	);
}
