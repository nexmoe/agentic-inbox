// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader } from "@cloudflare/kumo";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { typeClass } from "@/lib/type-scale";
import { emailListKey } from "~/lib/email-pages";
import type { Email } from "~/types";

interface VirtualMailListProps {
	emails: Email[];
	mailboxId?: string;
	totalCount: number;
	estimateSize: number;
	hasNextPage: boolean;
	isFetching: boolean;
	isFetchingNextPage: boolean;
	isFetchNextPageError: boolean;
	fetchNextPage: (options: { cancelRefetch: boolean }) => Promise<unknown>;
	renderEmail: (email: Email) => ReactNode;
}

export default function VirtualMailList({
	emails, mailboxId, totalCount, estimateSize, hasNextPage, isFetching,
	isFetchingNextPage, isFetchNextPageError, fetchNextPage, renderEmail,
}: VirtualMailListProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const focusedIndex = focusedKey === null ? -1 : emails.findIndex((email) => emailListKey(email, mailboxId) === focusedKey);
	const rangeExtractor = useCallback((range: Range) => {
		const indexes = defaultRangeExtractor(range);
		// Preserve keyboard focus even when the focused row scrolls off screen.
		if (focusedIndex >= 0 && !indexes.includes(focusedIndex)) {
			indexes.push(focusedIndex);
			indexes.sort((a, b) => a - b);
		}
		return indexes;
	}, [focusedIndex]);
	const getItemKey = useCallback((index: number) =>
		index < emails.length ? emailListKey(emails[index], mailboxId) : "next-page",
	[emails, mailboxId]);
	const virtualizer = useVirtualizer({
		count: emails.length + (hasNextPage ? 1 : 0),
		getScrollElement: () => scrollRef.current,
		estimateSize: () => estimateSize,
		getItemKey,
		overscan: 6,
		rangeExtractor,
	});
	const totalSize = virtualizer.getTotalSize();
	const viewportHeight = virtualizer.scrollRect?.height;
	const loadNearBottom = useCallback(() => {
		const element = scrollRef.current;
		if (element && hasNextPage && !isFetching && !isFetchNextPageError &&
			element.scrollHeight - element.scrollTop - element.clientHeight < 500) {
			void fetchNextPage({ cancelRefetch: false });
		}
	}, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

	useEffect(loadNearBottom, [loadNearBottom, totalSize, viewportHeight]);

	return (
		<div ref={scrollRef} data-mail-scroll data-mail-loaded-count={emails.length}
			className="min-h-0 flex-1 overflow-y-auto" onScroll={loadNearBottom}>
			<div role="list" aria-label="邮件列表" className="relative w-full" style={{ height: totalSize }}>
				{virtualizer.getVirtualItems().map((item) => {
					const email = emails[item.index];
					return (
						<div key={item.key} data-index={item.index} ref={virtualizer.measureElement}
							data-mail-virtual-row={email ? "email" : "loading"}
							role={email ? "listitem" : undefined}
							aria-posinset={email ? item.index + 1 : undefined}
							aria-setsize={email ? totalCount : undefined}
							onFocusCapture={() => email && setFocusedKey(emailListKey(email, mailboxId))}
							onBlurCapture={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null);
							}}
							className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${item.start}px)` }}>
							{email ? renderEmail(email) : (
								<div className={`flex min-h-16 items-center justify-center gap-3 px-4 py-4 text-kumo-subtle ${typeClass("caption")}`}>
									{isFetchNextPageError ? <>
										<span role="alert">暂时无法加载更多邮件。</span>
										<Button size="sm" variant="secondary" onClick={() => void fetchNextPage({ cancelRefetch: false })} disabled={isFetching}>重试</Button>
									</> : <span role="status" className="flex items-center gap-2">
										{isFetchingNextPage && <Loader size="sm" />}
										{isFetchingNextPage ? "正在加载更多邮件…" : "向下滚动加载更多"}
									</span>}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
