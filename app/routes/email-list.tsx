// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowsClockwiseIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import { Folders } from "shared/folders";
import { formatListDate } from "shared/dates";
import MailboxSplitView from "~/components/MailboxSplitView";
import MobileSidebarToggle from "~/components/MobileSidebarToggle";
import MailSearch from "~/components/MailSearch";
import MailAddressLine from "~/components/MailAddressLine";
import VirtualMailList from "~/components/VirtualMailList";
import { flattenEmailPages } from "~/lib/email-pages";
import SenderAvatar from "~/components/email-panel/SenderAvatar";
import { Tabs, TabsList, TabItem } from "@/components/ui/tabs";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";
import { getSnippetText } from "~/lib/utils";
import {
	useDeleteEmail,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
	useUnifiedEmails,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import { useActiveMailboxId, useUnifiedMailbox } from "~/hooks/useActiveMailbox";
import type { Email } from "~/types";

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: (
			<PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description:
			"Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description:
			"Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

function EmailListSkeleton() {
	return (
		<div className="animate-pulse">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="px-4 py-3 md:px-5">
					<div className="flex-1 space-y-2">
						<div className="flex items-center gap-2">
							<div className="h-3 w-24 rounded bg-kumo-fill" />
							<div className="h-3 w-4 rounded bg-kumo-fill" />
							<div className="h-3 flex-1 rounded bg-kumo-fill" />
							<div className="h-3 w-12 rounded bg-kumo-fill" />
						</div>
						<div className="h-2.5 w-3/4 rounded bg-kumo-fill" />
					</div>
				</div>
			))}
		</div>
	);
}

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: (
			<EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">
				{config.title}
			</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">
				{config.description}
			</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					Compose
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const unified = useUnifiedMailbox();
	const { folder } = useParams<{ folder: string }>();
	const [searchParams, setSearchParams] = useSearchParams();
	const unreadOnly = searchParams.get("unread") === "true";
	const mailboxId = useActiveMailboxId();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
		selectMailbox,
	} = useUIStore();
	const identity = `${unified ? "all" : mailboxId}/${folder}/${unreadOnly}`;
	const prevFolderRef = useRef(identity);
	const folderChanged = prevFolderRef.current !== identity;

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();

	const params = useMemo(
		() => ({
			folder: folder || Folders.INBOX,
			unread: String(unreadOnly),
		}),
		[folder, unreadOnly],
	);

	const mailboxQuery = useEmails(mailboxId, params, { enabled: !unified });
	const unifiedQuery = useUnifiedEmails(folder || Folders.INBOX, unified, unreadOnly);
	const activeQuery = unified ? unifiedQuery : mailboxQuery;
	const emailData = activeQuery.data;
	const isRefreshing = activeQuery.isFetching;

	const emails = useMemo(() => flattenEmailPages(emailData?.pages, mailboxId), [emailData, mailboxId]);
	const totalCount = emailData?.pages[0]?.totalCount ?? 0;

	const { data: folders = [] } = useFolders(mailboxId);

	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
	}, [folders, folder]);

	useEffect(() => {
		prevFolderRef.current = identity;

		if (folderChanged) {
			closePanel();
		}
	}, [identity, folderChanged, closePanel]);

	const setMailFilter = (value: string) => {
		const next = new URLSearchParams(searchParams);
		if (value === "unread") next.set("unread", "true");
		else next.delete("unread");
		setSearchParams(next);
	};

	const handleDelete = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		const targetMailboxId = email.mailbox_id || mailboxId;
		if (targetMailboxId) {
			const confirmed = window.confirm("Are you sure you want to delete this email?");
			if (!confirmed) return;
			deleteEmail.mutate({ mailboxId: targetMailboxId, id: email.id });
			if (selectedEmailId === email.id && mailboxId === targetMailboxId) closePanel();
		}
	};

	const handleRefresh = () => {
		// Reset the active list to its first page rather than refetching every
		// previously loaded page. Remounting the list also resets its scroll.
		const queryKey = unified
			? queryKeys.unifiedEmails.infinite(params.folder, unreadOnly)
			: queryKeys.emails.infinite(mailboxId!, { ...params, threaded: "true" });
		void queryClient.resetQueries({ queryKey, exact: true });
		if (mailboxId) {
			void queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		}
	};

	// Thread-aware helpers
	const hasUnread = (email: Email): boolean => {
		if (email.thread_unread_count !== undefined) {
			return email.thread_unread_count > 0;
		}
		return !email.read;
	};

	const handleRowClick = (email: Email) => {
		const targetMailboxId = email.mailbox_id || mailboxId;
		if (unified && targetMailboxId) selectMailbox(targetMailboxId);
		selectEmail(email.id);
		if (targetMailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({
					mailboxId: targetMailboxId,
					threadId: email.thread_id,
				});
			} else {
				updateEmail.mutate({
					mailboxId: targetMailboxId,
					id: email.id,
					data: { read: true },
				});
			}
		}
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
				{/* Folder header */}
				<div className="mail-pane-header gap-2 px-4 md:px-5" data-mail-header="list">
					<MobileSidebarToggle />
					<h1 className={`${typeClass("display")} truncate`} style={{ fontVariationSettings: fontWeights.bold }}>
						{folderName}
					</h1>
					<Tabs value={unreadOnly ? "unread" : "all"} onValueChange={setMailFilter} className="ml-auto shrink-0">
						<TabsList aria-label="Filter emails">
							<TabItem value="all" label="All mail" />
							<TabItem value="unread" label="Unread" />
						</TabsList>
					</Tabs>
				</div>

				<MailSearch />
				{/* Only the visible portion of loaded pages is mounted. */}
				{emails.length > 0 ? (
					<VirtualMailList
						key={identity}
						emails={emails}
						mailboxId={mailboxId}
						totalCount={totalCount}
						estimateSize={66}
						hasNextPage={!!activeQuery.hasNextPage}
						isFetching={isRefreshing}
						isFetchingNextPage={activeQuery.isFetchingNextPage}
						isFetchNextPageError={activeQuery.isFetchNextPageError}
						fetchNextPage={activeQuery.fetchNextPage}
						renderEmail={(email) => {
							const isSelected = selectedEmailId === email.id && (!unified || mailboxId === email.mailbox_id);
							const aiTitle = email.ai_title?.trim();
							const snippet = aiTitle ? "" : getSnippetText(email.snippet);
							return (
								<div
									data-mail-email-id={email.id}
									data-mail-mailbox-id={email.mailbox_id || mailboxId}
									role="button"
									tabIndex={0}
									onClick={() => handleRowClick(email)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											handleRowClick(email);
										}
									}}
									className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-3 md:px-5 ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
								>
									<SenderAvatar sender={email.sender} />
									{/* Content */}
									<div data-mail-row-content className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<MailAddressLine sender={email.sender} recipient={email.recipient} unread={hasUnread(email)} />
											{hasUnread(email) && <span className="h-2 w-2 shrink-0 rounded-full bg-kumo-brand" aria-label="Unread" />}
										</div>
										<div className="mt-0.5 flex min-w-0 items-center gap-2">
											<div className="min-w-0 flex-1 truncate text-sm">
												<span className={hasUnread(email) ? "font-medium text-kumo-default" : "text-kumo-subtle"}>
													{aiTitle || email.subject}
												</span>
												{snippet && <span className="text-kumo-subtle font-normal"> &mdash; {snippet}</span>}
											</div>
											{(email.thread_count ?? 1) > 1 && (
												<span className="shrink-0 text-xs text-kumo-subtle bg-kumo-fill rounded-full px-1.5 py-0.5 font-medium">
													{email.thread_count}
												</span>
											)}
											{email.has_draft && (
												<span className="shrink-0 text-xs text-kumo-destructive font-medium">
													Draft
												</span>
											)}
											{email.needs_reply && !email.has_draft && (
												<Tooltip content="Needs reply" asChild>
													<span className="shrink-0 text-kumo-warning">
														<ArrowBendUpLeftIcon size={14} weight="bold" />
													</span>
												</Tooltip>
											)}
											<span className={`${typeClass("caption")} text-kumo-subtle shrink-0`}>
												{formatListDate(email.date)}
											</span>
										</div>
									</div>

									{/* Hover actions */}
									<div className="hidden group-hover:flex items-center shrink-0">
										<Tooltip content={email.read ? "Mark unread" : "Mark read"} asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />}
												onClick={(e) => {
													e.stopPropagation();
													if (email.mailbox_id || mailboxId)
														updateEmail.mutate({
															mailboxId: (email.mailbox_id || mailboxId)!,
															id: email.id,
															data: { read: !email.read },
														});
												}}
												aria-label={email.read ? "Mark unread" : "Mark read"}
											/>
										</Tooltip>
										<Tooltip content="Delete" asChild>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												icon={<TrashIcon size={14} />}
												onClick={(e) => handleDelete(e, email)}
												aria-label="Delete"
											/>
										</Tooltip>
									</div>
								</div>
							);
						}}
					/>
				) : (
					<div className="min-h-0 flex-1 overflow-y-auto">
						{activeQuery.isError ? (
							<div className="p-6 text-sm text-kumo-subtle" role="alert"><p>暂时无法加载邮件。</p><Button size="sm" variant="secondary" className="mt-3" onClick={handleRefresh}>重试</Button></div>
						) : activeQuery.isLoading ? (
							<EmailListSkeleton />
						) : unreadOnly ? (
							<div className="px-6 py-24 text-center text-sm text-kumo-subtle">No unread emails</div>
						) : <FolderEmptyState folder={folder} onCompose={() => startCompose()} />}
					</div>
				)}
				{activeQuery.isRefetchError && emails.length > 0 && (
					<p role="alert" className="shrink-0 px-4 py-2 text-xs text-kumo-subtle">刷新失败，当前显示已加载的邮件。请重试刷新。</p>
				)}

				{/* Count and refresh */}
				<div className="flex items-center justify-between border-t border-kumo-line px-4 py-2 shrink-0">
					<span className="text-xs text-kumo-subtle" role="status">{totalCount} {unified ? "封邮件" : `conversation${totalCount === 1 ? "" : "s"}`}</span>
					<Tooltip content={isRefreshing ? "Refreshing…" : "Refresh"} asChild><Button variant="ghost" shape="square" size="sm" icon={<ArrowsClockwiseIcon size={16} className={isRefreshing ? "animate-spin motion-reduce:animate-none" : ""} />} onClick={handleRefresh} disabled={isRefreshing} aria-label="Refresh" /></Tooltip>
				</div>
		</MailboxSplitView>
	);
}
