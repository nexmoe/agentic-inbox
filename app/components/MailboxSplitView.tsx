// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import ComposePanel from "~/components/ComposePanel";
import EmailPanel from "~/components/EmailPanel";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { useUIStore } from "~/hooks/useUIStore";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";

interface MailboxSplitViewProps {
	selectedEmailId: string | null;
	isComposing: boolean;
	children: ReactNode;
}

export default function MailboxSplitView({
	selectedEmailId,
	isComposing,
	children,
}: MailboxSplitViewProps) {
	const isPanelOpen = selectedEmailId !== null || isComposing;
	const mailboxId = useActiveMailboxId();
	const panelKey = `${mailboxId}:${selectedEmailId}`;
	const closePanel = useUIStore((state) => state.closePanel);

	return (
		<div className="flex h-full min-h-0">
			<div
				className={`flex flex-col min-w-0 w-full md:w-[320px] xl:w-[420px] shrink-0 md:border-r md:border-kumo-line ${
					isPanelOpen
						? "hidden md:flex"
						: "flex"
				}`}
			>
				{children}
			</div>
			{isPanelOpen && (
				<div className="@container flex-1 flex flex-col min-w-0 overflow-hidden w-full md:w-auto">
					{isComposing && !selectedEmailId ? (
						<ComposePanel />
					) : isComposing && selectedEmailId ? (
						<div className="flex flex-col h-full overflow-y-auto">
							<ComposePanel />
							<div className="border-t border-kumo-line">
								<EmailPanel key={panelKey} emailId={selectedEmailId} />
							</div>
						</div>
					) : selectedEmailId ? (
						<EmailPanel key={panelKey} emailId={selectedEmailId} />
					) : null}
				</div>
			)}
			{!isPanelOpen && <div className="@container hidden md:flex flex-1 min-w-0 flex-col">
				<EmailPanelToolbar isDraftFolder={false} isSending={false} moveToFolders={[]} onBack={closePanel} />
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-kumo-subtle">
					<EnvelopeSimpleIcon size={32} weight="thin" />
					<p className="text-sm">Select an email to read</p>
				</div>
			</div>}
		</div>
	);
}
