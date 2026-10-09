// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { GearSixIcon, RobotIcon } from "@phosphor-icons/react";
import { useLocation, useNavigate } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";

/** Secondary controls sit below navigation, keeping the pane headers aligned. */
export default function Header() {
	const mailboxId = useActiveMailboxId();
	const navigate = useNavigate();
	const location = useLocation();
	const { toggleAgentPanel, isAgentPanelOpen, closeSidebar } = useUIStore();
	const isSettingsActive = location.pathname.includes("/settings");

	return (
		<div className="shrink-0 border-t border-kumo-line p-3 space-y-3">
			<div className="flex items-center gap-2">
				<Button variant={isAgentPanelOpen ? "secondary" : "ghost"} icon={<RobotIcon size={18} />} onClick={toggleAgentPanel} disabled={!mailboxId} aria-label="Toggle agent panel" aria-pressed={isAgentPanelOpen} className="hidden lg:inline-flex flex-1 justify-start h-9">Agent</Button>
				<Tooltip content="Mailbox settings" side="top" asChild>
					<Button variant={isSettingsActive ? "secondary" : "ghost"} shape="square" icon={<GearSixIcon size={18} />} onClick={() => {
						navigate(isSettingsActive ? `/mailbox/${mailboxId}/emails/inbox` : `/mailbox/${mailboxId}/settings`);
						closeSidebar();
					}} aria-label="Settings" disabled={!mailboxId} className="h-9 w-9" />
				</Tooltip>
			</div>
		</div>
	);
}
