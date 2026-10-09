// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { spring } from "@/lib/springs";
import ComposePanel from "~/components/ComposePanel";
import EmailPanel from "~/components/EmailPanel";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";

interface MailboxSplitViewProps {
	selectedEmailId: string | null;
	isComposing: boolean;
	children: ReactNode;
}

function MailDetailPane({ width, desktop, children }: {
	width: number;
	desktop: boolean;
	children: ReactNode;
}) {
	const isPresent = useIsPresent();
	const reduceMotion = useReducedMotion();
	const closedX = !desktop && !reduceMotion ? 24 : 0;
	const closedWidth = desktop ? 0 : width;

	return (
		<motion.div
			data-mail-detail
			inert={!isPresent}
			aria-hidden={!isPresent || undefined}
			className="absolute inset-y-0 right-0 z-10 shrink-0 overflow-hidden bg-kumo-base md:relative md:inset-auto md:z-auto"
			initial={{ width: reduceMotion ? width : closedWidth, opacity: 0, x: closedX }}
			animate={{ width, opacity: 1, x: 0 }}
			exit={{
				width: closedWidth, opacity: 0, x: closedX,
				transition: {
					type: "tween",
					...spring.slow.exit,
					width: reduceMotion ? { duration: 0 } : { type: "tween", ...spring.slow.exit },
				},
			}}
			transition={{
				...spring.slow,
				width: reduceMotion ? { duration: 0 } : spring.slow,
				opacity: spring.fast,
			}}
		>
			<div className="@container flex h-full min-w-0 flex-col overflow-hidden md:border-l md:border-kumo-line" style={{ width }}>
				{children}
			</div>
		</motion.div>
	);
}

export default function MailboxSplitView({
	selectedEmailId,
	isComposing,
	children,
}: MailboxSplitViewProps) {
	const isPanelOpen = selectedEmailId !== null || isComposing;
	const mailboxId = useActiveMailboxId();
	const panelKey = `${mailboxId}:${selectedEmailId}`;
	const containerRef = useRef<HTMLDivElement>(null);
	const [{ width, desktop }, setPanelSize] = useState({ width: 0, desktop: false });

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const measure = () => {
			const desktop = window.innerWidth >= 768;
			const listWidth = desktop ? (window.innerWidth >= 1280 ? 420 : 320) : 0;
			const width = Math.max(0, container.clientWidth - listWidth);
			setPanelSize((previous) => previous.width === width && previous.desktop === desktop ? previous : { width, desktop });
		};
		const observer = new ResizeObserver(measure);
		observer.observe(container);
		window.addEventListener("resize", measure);
		measure();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);

	return (
		<div ref={containerRef} data-mail-split className="relative flex h-full min-h-0 overflow-hidden">
			<div
				data-mail-list
				inert={isPanelOpen && !desktop}
				aria-hidden={(isPanelOpen && !desktop) || undefined}
				className="flex min-w-0 flex-1 flex-col"
			>
				{children}
			</div>
			{/* Reflow the list as the pane reveals its fixed-width content. This
			    avoids stretching text with scale; reduced motion snaps the width. */}
			<AnimatePresence initial={false}>
				{isPanelOpen && (
					<MailDetailPane key="mail-detail" width={width} desktop={desktop}>
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
					</MailDetailPane>
				)}
			</AnimatePresence>
		</div>
	);
}
