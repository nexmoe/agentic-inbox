// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Tooltip } from "@cloudflare/kumo";
import { GearSixIcon, MagnifyingGlassIcon, RobotIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";

/** Secondary controls sit below navigation, keeping the pane headers aligned. */
export default function Header({ unified = false }: { unified?: boolean }) {
	const [searchQuery, setSearchQuery] = useState("");
	const mailboxId = useActiveMailboxId();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const { toggleAgentPanel, isAgentPanelOpen, closeSidebar } = useUIStore();
	const isSettingsActive = location.pathname.includes("/settings");
	const urlQuery = searchParams.get("q") || "";

	useEffect(() => {
		setSearchQuery(location.pathname.includes("/search") ? urlQuery : "");
	}, [urlQuery, location.pathname]);

	return (
		<div className="shrink-0 border-t border-kumo-line p-3 space-y-3">
			{!unified && <form className="flex items-center gap-1" onSubmit={(event) => {
				event.preventDefault();
				if (mailboxId && searchQuery.trim()) {
					navigate(`/mailbox/${mailboxId}/search?q=${encodeURIComponent(searchQuery.trim())}`);
					closeSidebar();
				}
			}}>
				<Input className="w-full min-w-0" aria-label="Search emails" placeholder="Search emails…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => {
					if (event.key === "Escape") setSearchQuery("");
				}} />
				<Button type="submit" variant="ghost" shape="square" icon={<MagnifyingGlassIcon size={18} />} aria-label="Search" disabled={!searchQuery.trim()} />
			</form>}
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
