import type { EmailSearchCursor, EmailSearchFilters } from "../../shared/email-search";
import { searchSignature } from "../../shared/email-search";
import { listMailboxEmailPages } from "./unified-inbox";

export function buildSearchConditions(options: EmailSearchFilters, alias = "", continuation?: { mailboxId: string; cursor: EmailSearchCursor }) {
	const prefix = alias ? `${alias}.` : "";
	const conditions: string[] = [];
	const params: (string | number)[] = [];
	const param = (value: string | number) => { params.push(value); return `?${params.length}`; };
	const matchText = (columns: string[], value: string) => {
		// User text is literal, including SQL LIKE's wildcard characters.
		const valueParam = param(`%${value.replace(/[\\%_]/g, "\\$&")}%`);
		return `(${columns.map((column) => `${prefix}${column} LIKE ${valueParam} ESCAPE '\\'`).join(" OR ")})`;
	};
	// Match every word anywhere in the complete message, not just its preview.
	// Double quotes keep a phrase together; Chinese text also matches substrings.
	const terms = options.query.match(/"([^"]+)"|[^\s"]+/g) ?? [];
	for (const term of terms) {
		conditions.push(matchText(["subject", "ai_title", "body", "sender", "recipient", "cc", "bcc"], term.replace(/^"|"$/g, "")));
	}
	if (options.folder) {
		const valueParam = param(options.folder);
		conditions.push(`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${valueParam} OR id = ${valueParam} LIMIT 1)`);
	}
	if (options.from) conditions.push(matchText(["sender"], options.from));
	if (options.to) conditions.push(matchText(["recipient", "cc", "bcc"], options.to));
	if (options.subject) conditions.push(matchText(["subject"], options.subject));
	if (options.date_start) conditions.push(`${prefix}date >= ${param(options.date_start)}`);
	if (options.date_end) conditions.push(`${prefix}date <= ${param(options.date_end)}`);
	if (options.is_read !== undefined) conditions.push(`${prefix}read = ${param(options.is_read ? 1 : 0)}`);
	if (options.is_starred !== undefined) conditions.push(`${prefix}starred = ${param(options.is_starred ? 1 : 0)}`);
	if (options.has_attachment) conditions.push(`${prefix}id IN (SELECT DISTINCT email_id FROM attachments)`);
	if (continuation) {
		const { cursor, mailboxId } = continuation;
		const dateParam = param(cursor.date);
		const tie = mailboxId > cursor.mailboxId ? "1" : mailboxId < cursor.mailboxId ? "0" : `${prefix}id > ${param(cursor.id)}`;
		conditions.push(`(COALESCE(${prefix}date, '') < ${dateParam} OR (COALESCE(${prefix}date, '') = ${dateParam} AND (${tie})))`);
	}
	return { conditions, params };
}

export function decodeSearchCursor(value: string, filters: EmailSearchFilters): EmailSearchCursor {
	if (value.length > 8192) throw new Error("Invalid search cursor");
	try {
		const cursor = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))));
		if (cursor.search !== searchSignature(filters) || typeof cursor.date !== "string" || cursor.date.length > 64 ||
			typeof cursor.mailboxId !== "string" || !cursor.mailboxId || cursor.mailboxId.length > 320 ||
			typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 256) throw new Error();
		return cursor;
	} catch { throw new Error("Invalid search cursor"); }
}

export function listUnifiedSearch<T extends { id: string; date: string | null }>(
	mailboxIds: string[], filters: EmailSearchFilters, limit: number, cursor: EmailSearchCursor | undefined,
	load: (mailboxId: string, limit: number, cursor?: EmailSearchCursor) => Promise<{ emails: T[]; totalCount: number }>,
) {
	return listMailboxEmailPages(mailboxIds, limit, (mailboxId, batchSize) => load(mailboxId, batchSize, cursor), (last) => {
		const next: EmailSearchCursor = { date: last.date ?? "", mailboxId: last.mailbox_id, id: last.id, search: searchSignature(filters) };
		// Search text can be Unicode; encode UTF-8 before base64.
		return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(next))))
			.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	});
}
