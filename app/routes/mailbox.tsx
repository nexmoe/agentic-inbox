// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet } from "react-router";
import { useActiveMailboxId, useUnifiedMailbox } from "~/hooks/useActiveMailbox";
import AgentSidebar from "~/components/AgentSidebar";
import ComposeEmail from "~/components/ComposeEmail";
import Sidebar from "~/components/Sidebar";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

export default function MailboxRoute() {
	const unified = useUnifiedMailbox();
	const mailboxId = useActiveMailboxId();
	// Prefetch mailbox data for child components
	useMailbox(mailboxId);
	const prevMailboxIdRef = useRef<string | undefined>(undefined);
	const {
		isSidebarOpen,
		closeSidebar,
		isAgentPanelOpen,
		closePanel,
		closeComposeModal,
	} = useUIStore();

	useEffect(() => {
		if (
			!unified && prevMailboxIdRef.current &&
			mailboxId &&
			prevMailboxIdRef.current !== mailboxId
		) {
			closePanel();
			closeComposeModal();
			closeSidebar();
		}

		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, unified, closeComposeModal, closePanel, closeSidebar]);

	return (
		<div className="flex h-dvh overflow-hidden bg-kumo-base">
			{/* Mobile sidebar overlay backdrop */}
			{isSidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/30 lg:hidden"
					onClick={closeSidebar}
					onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
					role="button"
					tabIndex={-1}
					aria-label="Close sidebar"
				/>
			)}

			{/* Sidebar: hidden on mobile by default, shown as overlay when open */}
			<div
				className={`mail-sidebar fixed inset-y-0 left-0 z-40 w-[280px] lg:relative lg:translate-x-0 lg:z-0 ${
					isSidebarOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<Sidebar unified={unified} />
			</div>

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0 bg-kumo-base">
				<main className="flex-1 min-h-0 overflow-hidden">
					<Outlet />
				</main>
			</div>

			{/* Agent + MCP sidebar -- togglable on desktop */}
			{isAgentPanelOpen && mailboxId && (
				<div className="hidden lg:flex fixed inset-y-0 right-0 z-20 2xl:relative 2xl:z-0 w-[380px] shrink-0 border-l border-kumo-line flex-col bg-kumo-base overflow-hidden shadow-lg 2xl:shadow-none">
					<AgentSidebar />
				</div>
			)}

			<ComposeEmail />
		</div>
	);
}
