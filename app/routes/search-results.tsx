// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Tooltip } from "@cloudflare/kumo";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import MailboxSplitView from "~/components/MailboxSplitView";
import MobileSidebarToggle from "~/components/MobileSidebarToggle";
import VirtualMailList from "~/components/VirtualMailList";
import { flattenEmailPages } from "~/lib/email-pages";
import SenderAvatar from "~/components/email-panel/SenderAvatar";
import { formatListDate, getSnippetText } from "~/lib/utils";
import { useUpdateEmail } from "~/queries/emails";
import { useSearchEmails } from "~/queries/search";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "").replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "").trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) => part.toLowerCase() === lowerEscaped ? <mark key={i} className="bg-kumo-warning-muted text-kumo-default rounded-sm px-0.5">{part}</mark> : part);
	} catch { return text; }
}

export default function SearchResultsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { selectedEmailId, isComposing, selectEmail, closePanel } = useUIStore();
	const updateEmail = useUpdateEmail();
	const urlQuery = searchParams.get("q") || "";
	const searchKey = useMemo(
		() => `${mailboxId ?? ""}::${urlQuery}`,
		[mailboxId, urlQuery],
	);
	const prevSearchKeyRef = useRef(searchKey);
	const searchChanged = prevSearchKeyRef.current !== searchKey;

	useEffect(() => {
		if (!searchChanged) {
			return;
		}

		prevSearchKeyRef.current = searchKey;
		closePanel();
	}, [closePanel, searchChanged, searchKey]);

	const searchQuery = useSearchEmails(mailboxId, urlQuery);
	const { data: searchData, isLoading } = searchQuery;
	const results = useMemo(() => flattenEmailPages(searchData?.pages, mailboxId), [searchData, mailboxId]);
	const totalCount = searchData?.pages[0]?.totalCount ?? 0;
	const handleRowClick = (email: Email) => { selectEmail(email.id); if (!email.read && mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } }); };
	const folderDisplayName = (name: string | null | undefined): string => { if (!name) return ""; const map: Record<string, string> = { inbox: "Inbox", sent: "Sent", draft: "Drafts", archive: "Archive", trash: "Trash" }; return map[name.toLowerCase()] || name; };

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
			<>
				<div className="mail-pane-header gap-2 px-4 md:px-5" data-mail-header="search">
					<MobileSidebarToggle />
					<Tooltip content="Back to inbox" side="bottom" asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowLeftIcon size={18} />} onClick={() => navigate(`/mailbox/${mailboxId}/emails/inbox`)} aria-label="Back to inbox" /></Tooltip>
					<div className="min-w-0 flex-1"><h1 className="text-lg font-semibold text-kumo-default truncate">Search Results</h1>{!isLoading && <span className="text-sm text-kumo-subtle">{totalCount} result{totalCount !== 1 ? "s" : ""}{urlQuery ? ` for "${urlQuery}"` : ""}</span>}</div>
				</div>
				{results.length > 0 ? (
					<VirtualMailList key={searchKey} emails={results} mailboxId={mailboxId}
						totalCount={totalCount} estimateSize={82}
						hasNextPage={!!searchQuery.hasNextPage}
						isFetching={searchQuery.isFetching}
						isFetchingNextPage={searchQuery.isFetchingNextPage}
						isFetchNextPageError={searchQuery.isFetchNextPageError}
						fetchNextPage={searchQuery.fetchNextPage}
						renderEmail={(email) => {
							const isSelected = selectedEmailId === email.id;
							const aiTitle = email.ai_title?.trim();
							const snippet = aiTitle ? "" : getSnippetText(email.snippet, 120);
							const folderName = (email as Email & { folder_name?: string }).folder_name;
							return (
								<div data-mail-email-id={email.id} data-mail-mailbox-id={mailboxId} role="button" tabIndex={0} onClick={() => handleRowClick(email)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(email); } }} className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-3 md:px-5 ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}>
									<SenderAvatar sender={email.sender} />
									<div data-mail-row-content className="min-w-0 flex-1">
										<div className="flex items-center gap-2"><span className={`truncate text-sm ${!email.read ? "font-semibold text-kumo-default" : "text-kumo-strong"}`}>{highlightTerms(email.sender.split("@")[0], urlQuery)}</span>{!email.read && <span className="h-2 w-2 shrink-0 rounded-full bg-kumo-brand" aria-label="Unread" />}{folderName && <Badge variant="outline">{folderDisplayName(folderName)}</Badge>}<span className="text-sm text-kumo-subtle shrink-0 ml-auto">{formatListDate(email.date)}</span></div>
										<div className={`truncate text-sm mt-0.5 ${!email.read ? "font-medium text-kumo-default" : "text-kumo-subtle"}`}>{highlightTerms(aiTitle || email.subject, urlQuery)}</div>
										{snippet && <div className="truncate text-xs text-kumo-subtle mt-0.5">{highlightTerms(snippet, urlQuery)}</div>}
									</div>
								</div>
							);
						}}
					/>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto">
						{isLoading ? <div className="flex justify-center py-16"><Loader size="lg" /></div> : searchQuery.isError ? (
							<div className="p-6 text-sm text-kumo-subtle" role="alert"><p>暂时无法加载搜索结果。</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => void searchQuery.refetch()}>重试</Button></div>
						) : (
						<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
							<div className="mb-4"><MagnifyingGlassIcon size={48} weight="thin" className="text-kumo-subtle" /></div>
							<h3 className="text-base font-semibold text-kumo-default mb-1.5">No results found</h3>
							<p className="text-sm text-kumo-subtle max-w-xs">{urlQuery ? `Nothing matched "${urlQuery}". Try different keywords or check your spelling.` : "Enter a search term to find emails by subject, sender, or content."}</p>
							{urlQuery && <p className="text-xs text-kumo-subtle mt-3 max-w-sm">Tip: Use operators like <code className="bg-kumo-tint px-1 rounded">from:name</code>, <code className="bg-kumo-tint px-1 rounded">is:unread</code>, <code className="bg-kumo-tint px-1 rounded">has:attachment</code>, <code className="bg-kumo-tint px-1 rounded">before:2025-01-01</code></p>}
						</div>
						)}
					</div>
				)}
				{searchQuery.isRefetchError && results.length > 0 && <p role="alert" className="shrink-0 px-4 py-2 text-xs text-kumo-subtle">刷新搜索结果失败。<Button variant="ghost" size="sm" onClick={() => void searchQuery.refetch()}>重试</Button></p>}
			</>
		</MailboxSplitView>
	);
}
