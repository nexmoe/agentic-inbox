// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { InfiniteData } from "@tanstack/react-query";
import type { Email } from "../types/index";

export const EMAIL_PAGE_SIZE = 25;

export interface EmailListPage {
	emails: Email[];
	totalCount: number;
}

export function normalizeEmailPage(data: EmailListPage | Email[]): EmailListPage {
	return Array.isArray(data)
		? { emails: data, totalCount: data.length }
		: { ...data, emails: data.emails ?? [], totalCount: data.totalCount ?? 0 };
}

export function emailListKey(email: Pick<Email, "id" | "mailbox_id">, mailboxId = "") {
	return JSON.stringify([email.mailbox_id || mailboxId, email.id]);
}

export function flattenEmailPages(pages: readonly EmailListPage[] | undefined, mailboxId = ""): Email[] {
	const seen = new Set<string>();
	return (pages ?? []).flatMap((page) => page.emails.filter((email) => {
		const key = emailListKey(email, mailboxId);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}));
}

export function nextEmailPage(lastPage: EmailListPage, page: number) {
	return lastPage.emails.length > 0 && page * EMAIL_PAGE_SIZE < lastPage.totalCount
		? page + 1
		: undefined;
}

/** Keep cursors and page parameters intact when optimistically changing a row. */
export function patchEmailPages(
	cached: InfiniteData<EmailListPage> | undefined,
	mailboxId: string,
	id: string,
	patch: Partial<Email>,
): InfiniteData<EmailListPage> | undefined {
	if (!cached) return cached;
	return {
		...cached,
		pages: cached.pages.map((page) => ({
			...page,
			emails: page.emails.map((email) => {
				if (email.id !== id || (email.mailbox_id && email.mailbox_id !== mailboxId)) return email;
				const updated = { ...email, ...patch };
				if (typeof patch.read === "boolean" && (email.thread_count ?? 1) === 1 && email.thread_unread_count !== undefined) {
					updated.thread_unread_count = patch.read ? 0 : 1;
				}
				return updated;
			}),
		})),
	};
}
