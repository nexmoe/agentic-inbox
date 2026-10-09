// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Centralised query key factories for cache invalidation. */
export const queryKeys = {
	mailboxes: {
		all: ["mailboxes"] as const,
		detail: (id: string) => ["mailboxes", id] as const,
	},
	emails: {
		infinite: (mailboxId: string, params: Record<string, string>) =>
			["emails", mailboxId, params, "infinite"] as const,
		detail: (mailboxId: string, emailId: string) =>
			["emails", mailboxId, emailId] as const,
		thread: (mailboxId: string, threadId: string) =>
			["emails", mailboxId, "thread", threadId] as const,
	},
	emailSummaries: {
		detail: (mailboxId: string, threadId: string, revision: string) =>
			["email-summaries", mailboxId, threadId, revision] as const,
	},
	unifiedEmails: {
		all: ["unified-emails"] as const,
		infinite: (folder: string, unreadOnly = false) => ["unified-emails", "infinite", folder, unreadOnly] as const,
	},
	folders: {
		list: (mailboxId: string) => ["folders", mailboxId] as const,
	},
	search: {
		infinite: (mailboxId: string, query: string) =>
			["search", mailboxId, query, "infinite"] as const,
	},
	config: ["config"] as const,
};
