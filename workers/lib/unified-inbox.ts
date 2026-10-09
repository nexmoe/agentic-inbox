import type { UnifiedEmailCursor, UnifiedEmailPage } from "../../shared/unified-inbox";

export function unifiedEmailsQuery(folder: string, mailboxId: string, rawLimit: number, cursor?: UnifiedEmailCursor) {
	const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 51);
	const conditions = ["folder_id = ?"];
	const params: (string | number)[] = [folder];
	if (cursor) {
		const sameDate = mailboxId > cursor.mailboxId ? "1" : mailboxId < cursor.mailboxId ? "0" : "id > ?";
		conditions.push(`(COALESCE(date, '') < ? OR (COALESCE(date, '') = ? AND (${sameDate})))`);
		params.push(cursor.date, cursor.date);
		if (mailboxId === cursor.mailboxId) params.push(cursor.id);
	}
	return {
		sql: `SELECT id, subject, ai_title, sender, recipient, cc, bcc, date, read, starred, in_reply_to,
		 email_references, thread_id, folder_id, SUBSTR(body, 1, 300) AS snippet
		 FROM emails WHERE ${conditions.join(" AND ")}
		 ORDER BY COALESCE(date, '') DESC, id ASC LIMIT ?`,
		params: [...params, limit],
	};
}

export function decodeUnifiedCursor(value: string, folder: string): UnifiedEmailCursor {
	if (value.length > 2_048) throw new Error("Invalid cursor");
	try {
		const cursor = JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")));
		if (!cursor || cursor.folder !== folder || typeof cursor.date !== "string" || cursor.date.length > 64 ||
			typeof cursor.mailboxId !== "string" || !cursor.mailboxId || cursor.mailboxId.length > 320 ||
			typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 256) throw new Error();
		return cursor;
	} catch {
		throw new Error("Invalid cursor");
	}
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Fetch one bounded page per mailbox; merge with the same order as each SQL query. */
export async function listUnifiedEmails<T extends { id: string; date: string | null }>(
	mailboxIds: string[],
	options: { folder: string; limit: number; cursor?: UnifiedEmailCursor },
	load: (mailboxId: string, limit: number, cursor?: UnifiedEmailCursor) => Promise<{ emails: T[]; totalCount: number }>,
): Promise<UnifiedEmailPage<T>> {
	const pages = await Promise.all([...new Set(mailboxIds)].map(async (mailboxId) => {
		const page = await load(mailboxId, options.limit + 1, options.cursor);
		return { ...page, emails: page.emails.map((email) => ({ ...email, mailbox_id: mailboxId })) };
	}));
	const merged = pages.flatMap((page) => page.emails).sort((a, b) =>
		compare(b.date ?? "", a.date ?? "") || compare(a.mailbox_id, b.mailbox_id) || compare(a.id, b.id));
	const emails = merged.slice(0, options.limit);
	const last = emails.at(-1);
	return {
		emails,
		totalCount: pages.reduce((count, page) => count + page.totalCount, 0),
		nextCursor: merged.length > options.limit && last
			? btoa(JSON.stringify({ date: last.date ?? "", mailboxId: last.mailbox_id, id: last.id, folder: options.folder }))
				.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
			: null,
	};
}
