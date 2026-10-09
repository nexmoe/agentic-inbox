// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import api from "~/services/api";
import type { Email } from "~/types";
import { queryKeys } from "./keys";
import type { EmailSummaryState } from "../../shared/email-summary";
import { EMAIL_PAGE_SIZE, nextEmailPage, normalizeEmailPage, patchEmailPages, type EmailListPage } from "~/lib/email-pages";

// ---------- Queries ----------

export function useUnifiedEmails(folder: string, enabled: boolean, unreadOnly = false) {
	return useInfiniteQuery({
		queryKey: queryKeys.unifiedEmails.infinite(folder, unreadOnly),
		initialPageParam: "",
		queryFn: ({ pageParam, signal }) => api.listUnifiedEmails({ folder, cursor: pageParam, limit: String(EMAIL_PAGE_SIZE), unread: String(unreadOnly) }, { signal }),
		getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
		enabled,
		// Poll the newest page only while at the head. Do not repeatedly read
		// an entire archive after the user has scrolled through older pages.
		refetchInterval: (query) => (query.state.data?.pages.length ?? 0) <= 1 ? 30_000 : false,
	});
}

export function useEmails(
	mailboxId: string | undefined,
	params: Record<string, string>,
	options?: { enabled?: boolean },
) {
	const queryParams = params.folder
		? { ...params, threaded: "true" }
		: params;

	return useInfiniteQuery({
		queryKey: mailboxId
			? queryKeys.emails.infinite(mailboxId, queryParams)
			: ["emails", "_disabled"],
		initialPageParam: 1,
		queryFn: async ({ pageParam, signal }) => normalizeEmailPage(await api.listEmails(mailboxId!, {
			...queryParams, page: String(pageParam), limit: String(EMAIL_PAGE_SIZE),
		}, { signal })),
		getNextPageParam: (lastPage, _pages, lastPageParam) => nextEmailPage(lastPage, lastPageParam),
		enabled: !!mailboxId && (options?.enabled ?? true),
		refetchInterval: (query) => (query.state.data?.pages.length ?? 0) <= 1 ? 30_000 : false,
	});
}

export function useEmail(
	mailboxId: string | undefined,
	emailId: string | undefined,
) {
	return useQuery<Email>({
		queryKey: mailboxId && emailId
			? queryKeys.emails.detail(mailboxId, emailId)
			: ["emails", "_disabled_detail"],
		queryFn: () => api.getEmail(mailboxId!, emailId!) as Promise<Email>,
		enabled: !!mailboxId && !!emailId,
	});
}

export function useThreadReplies(
	mailboxId: string | undefined,
	threadId: string | undefined | null,
) {
	const qc = useQueryClient();

	return useQuery<Email[]>({
		queryKey: mailboxId && threadId
			? queryKeys.emails.thread(mailboxId, threadId)
			: ["emails", "_disabled_thread"],
		queryFn: async ({ signal }) => {
			// Single request returns all thread emails with full bodies +
			// attachments. Eliminates the previous N+1 pattern that fired
			// a separate getEmail call per thread message.
			const emails = await api.getThread(mailboxId!, threadId!, { signal }) as Email[];

			// Populate individual email detail caches so clicking a thread
			// message in the panel doesn't re-fetch.
			for (const email of emails) {
				qc.setQueryData(
					queryKeys.emails.detail(mailboxId!, email.id),
					email,
				);
			}

			return emails;
		},
		enabled: !!mailboxId && !!threadId,
	});
}

export function useEmailSummary(
	mailboxId: string | undefined,
	email: Email,
	revision: string,
	enabled: boolean,
) {
	return useQuery<EmailSummaryState>({
		queryKey: mailboxId
			? queryKeys.emailSummaries.detail(mailboxId, email.thread_id || email.id, revision)
			: ["email-summaries", "_disabled"],
		queryFn: ({ signal }) => api.getEmailSummary(mailboxId!, email.id, { signal }),
		enabled: !!mailboxId && enabled,
		staleTime: (query) => query.state.data?.status === "ready" ? Infinity : 0,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchInterval: (query) => query.state.data?.status === "pending" ? 2_000 : false,
	});
}

// ---------- Mutations ----------

/** Invalidate both the email list and folder counts after any email mutation. */
function useInvalidateEmailData() {
	const qc = useQueryClient();
	return (mailboxId: string) => {
		qc.invalidateQueries({ queryKey: queryKeys.unifiedEmails.all });
		qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
		qc.invalidateQueries({ queryKey: ["search", mailboxId] });
		qc.invalidateQueries({
			queryKey: queryKeys.folders.list(mailboxId),
		});
	};
}

export function useSendEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			email,
		}: { mailboxId: string; email: unknown }) =>
			api.sendEmail(mailboxId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateEmail() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: { mailboxId: string; id: string; data: unknown }) =>
			api.updateEmail(mailboxId, id, data),
		onMutate: async ({ mailboxId, id, data }) => {
			// Target unified, search and mailbox lists; exclude detail and thread queries.
			const isListQuery = (query: { queryKey: readonly unknown[] }) =>
				query.queryKey[0] === "unified-emails" || (query.queryKey[0] === "search" && query.queryKey[1] === mailboxId) || (
					query.queryKey[0] === "emails" &&
					query.queryKey[1] === mailboxId &&
					typeof query.queryKey[2] === "object" &&
					query.queryKey[2] !== null);

			// Cancel in-flight list queries so they don't overwrite our optimistic update
			await qc.cancelQueries({
				predicate: isListQuery,
			});

			// Snapshot current email list caches for rollback
			const listQueries = qc.getQueriesData<InfiniteData<EmailListPage>>({
				predicate: isListQuery,
			});

			// Optimistically patch every cached email list that contains this email
			for (const [key, cached] of listQueries) {
				qc.setQueryData(key, patchEmailPages(cached, mailboxId, id, data as Partial<Email>));
			}

			// Also patch the detail cache
			const detailKey = queryKeys.emails.detail(mailboxId, id);
			const prevDetail = qc.getQueryData<Email>(detailKey);
			if (prevDetail) {
				qc.setQueryData(detailKey, { ...prevDetail, ...(data as Partial<Email>) });
			}

			return { listQueries, prevDetail, detailKey };
		},
		onError: (_err, _vars, context) => {
			// Roll back optimistic updates on failure
			if (context?.listQueries) {
				for (const [key, cached] of context.listQueries) {
					qc.setQueryData(key, cached);
				}
			}
			if (context?.prevDetail) {
				qc.setQueryData(context.detailKey, context.prevDetail);
			}
		},
		onSettled: (_data, _err, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.unifiedEmails.all });
			// Always refetch to ensure server truth
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({ queryKey: ["search", mailboxId] });
			qc.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		},
	});
}

export function useMarkThreadRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			threadId,
		}: { mailboxId: string; threadId: string }) =>
			api.markThreadRead(mailboxId, threadId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.unifiedEmails.all });
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({ queryKey: ["search", mailboxId] });
			qc.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		},
	});
}

export function useDeleteEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
		}: { mailboxId: string; id: string }) =>
			api.deleteEmail(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useMoveEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			folderId,
		}: { mailboxId: string; id: string; folderId: string }) =>
			api.moveEmail(mailboxId, id, folderId),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useSaveDraft() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			draft,
		}: {
			mailboxId: string;
			draft: {
				to?: string;
				cc?: string;
				bcc?: string;
				subject?: string;
				body: string;
				in_reply_to?: string;
				thread_id?: string;
				draft_id?: string;
			};
		}) => api.saveDraft(mailboxId, draft),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useReplyToEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			email,
		}: { mailboxId: string; emailId: string; email: unknown }) =>
			api.replyToEmail(mailboxId, emailId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useForwardEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			email,
		}: { mailboxId: string; emailId: string; email: unknown }) =>
			api.forwardEmail(mailboxId, emailId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
