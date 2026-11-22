// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import type { UnifiedEmailCursor } from "../../shared/unified-inbox";
import { unifiedEmailsQuery } from "../lib/unified-inbox";
import { countThreadedEmailsQuery, threadedEmailsQuery } from "../lib/threaded-emails";
import { buildSearchConditions } from "../lib/email-search";
import type { EmailSearchCursor, EmailSearchFilters, EmailSearchResult } from "../../shared/email-search";
import { applyMigrations, mailboxMigrations } from "./migrations";
import { automatedOpen, OPEN_DEDUPLICATION_MS, OPEN_TOKEN_PATTERN, type OpenClient } from "../lib/open-tracking";
import type { EmailOpenTracking } from "../../shared/email-tracking";

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * Map SortColumn string names to Drizzle column references for safe
 * ORDER BY construction (no string interpolation into SQL).
 */
const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, typeof schema.emails[keyof typeof schema.emails]>;

interface GetEmailsOptions {
	folder?: string;
	unreadOnly?: boolean;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	track_opens?: boolean;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	/** Keyset pagination avoids downloading earlier pages from every mailbox. */
	async getUnifiedEmails(folder: string, mailboxId: string, rawLimit: number, cursor?: UnifiedEmailCursor, unreadOnly = false) {
		const query = unifiedEmailsQuery(folder, mailboxId, rawLimit, cursor, unreadOnly);
		const emails = [...this.ctx.storage.sql.exec(query.sql, ...query.params)];
		return emails.map((email) => ({
			...email, id: String(email.id), subject: String(email.subject ?? ""),
			sender: String(email.sender ?? ""), recipient: String(email.recipient ?? ""),
			date: String(email.date ?? ""), read: !!email.read, starred: !!email.starred,
			track_opens: !!email.track_opens, needs_reply: !!email.needs_reply, has_draft: !!email.has_draft,
			thread_count: Number(email.thread_count || 1), thread_unread_count: Number(email.thread_unread_count || 0),
			participants: String(email.participants || email.sender || ""),
		}));
	}

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			unreadOnly = false,
			thread_id,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (unreadOnly) conditions.push(eq(schema.emails.read, 0));
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				ai_title: schema.emails.ai_title,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				track_opens: schema.emails.track_opens,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
			track_opens: !!email.track_opens,
		}));
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; thread_id?: string; unreadOnly?: boolean } = {}) {
		const { folder, thread_id, unreadOnly = false } = options;
		const conditions: string[] = [];
		if (unreadOnly) conditions.push("read = 0");
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (shared with the unified Inbox) ────────────

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const { folder, unreadOnly = false, page = 1, limit: rawLimit = 25 } = options;
		if (!folder) return this.getEmails(options);
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const query = threadedEmailsQuery(folder, limit, unreadOnly, { offset: (page - 1) * limit });
		return [...this.ctx.storage.sql.exec(query.sql, ...query.params)].map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			track_opens: !!row.track_opens,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
			needs_reply: !!row.needs_reply,
			has_draft: !!row.has_draft,
		}));
	}

	/** Count conversations, using the same grouping and unread scope as the list. */
	async countThreadedEmails(folder: string, unreadOnly = false) {
		const query = countThreadedEmailsQuery(folder, unreadOnly);
		const row = [...this.ctx.storage.sql.exec(query.sql, ...query.params)][0];
		return Number(row?.total ?? 0);
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			track_opens: !!email.track_opens,
			attachments: emailAttachments,
		};
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		] as any[];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders})`,
				...emailIds,
			),
		] as any[];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, any[]>();
		for (const att of attachmentRows) {
			const list = attachmentsByEmail.get(att.email_id) || [];
			list.push(att);
			attachmentsByEmail.set(att.email_id, list);
		}

		return emailRows.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
			track_opens: !!email.track_opens,
			attachments: attachmentsByEmail.get(email.id) || [],
		}));
	}

	async getEmailOpenTracking(id: string): Promise<EmailOpenTracking | null> {
		const row = [...this.ctx.storage.sql.exec<{
			id: string; tracked_id: string | null; open_count: number | null;
			first_opened_at: number | null; last_opened_at: number | null;
		}>(`SELECT e.id, t.email_id AS tracked_id, t.open_count, t.first_opened_at, t.last_opened_at
			FROM emails e LEFT JOIN email_tracking t ON t.email_id = e.id WHERE e.id = ?`, id)][0];
		if (!row) return null;
		return {
			enabled: row.tracked_id !== null,
			openCount: row.open_count ?? 0,
			firstOpenedAt: row.first_opened_at === null ? null : new Date(row.first_opened_at).toISOString(),
			lastOpenedAt: row.last_opened_at === null ? null : new Date(row.last_opened_at).toISOString(),
		};
	}

	async recordEmailOpen(token: string, client: OpenClient): Promise<void> {
		if (!OPEN_TOKEN_PATTERN.test(token) || !/^[a-f0-9]{64}$/.test(client.fingerprint)) return;
		this.ctx.storage.transactionSync(() => {
			const tracking = this.db.select().from(schema.emailTracking).where(eq(schema.emailTracking.token, token)).get();
			const now = Date.now();
			if (!tracking || automatedOpen(client, tracking.sent_at, now)) return;
			// Keep only a bounded recent window, including interleaved clients and concurrent reloads.
			const recent = (JSON.parse(tracking.recent_clients) as { fingerprint: string; at: number }[])
				.filter((entry) => now - entry.at < OPEN_DEDUPLICATION_MS);
			if (recent.some((entry) => entry.fingerprint === client.fingerprint)) return;
			recent.push({ fingerprint: client.fingerprint, at: now });
			this.ctx.storage.sql.exec(`UPDATE email_tracking
				SET open_count = MIN(open_count + 1, 2147483647),
					first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ?, recent_clients = ?
				WHERE token = ?`, now, now, JSON.stringify(recent.slice(-64)), token);
		});
	}

	/** Save the conversation title only on messages actually read by the Agent. */
	async saveEmailTitle(emailIds: string[], title: string): Promise<void> {
		if (emailIds.length === 0) return;
		this.db.update(schema.emails)
			.set({ ai_title: title })
			.where(and(inArray(schema.emails.id, emailIds), sql`${schema.emails.folder_id} != ${Folders.DRAFT}`))
			.run();
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		this.db
			.delete(schema.emails)
			.where(eq(schema.emails.id, id))
			.run();

		return emailAttachments;
	}

	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.get() ?? null
		);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	async createFolder(id: string, name: string, is_deletable: number = 1) {
		try {
			const result = this.db
				.insert(schema.folders)
				.values({ id, name, is_deletable })
				.returning({ id: schema.folders.id, name: schema.folders.name })
				.get();
			return { ...result, unreadCount: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		const result = this.db
			.update(schema.folders)
			.set({ name })
			.where(eq(schema.folders.id, id))
			.returning({ id: schema.folders.id, name: schema.folders.name })
			.get();
		return result;
	}

	async deleteFolder(id: string) {
		const folder = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();

		if (!folder || folder.is_deletable === 0) {
			return false;
		}

		this.db
			.delete(schema.folders)
			.where(eq(schema.folders.id, id))
			.run();

		return true;
	}

	async moveEmail(id: string, folderId: string) {
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		return true;
	}

	// ── Search (raw SQL — dynamic condition builder) ───────────────

	async searchEmails(options: EmailSearchFilters & { page?: number; limit?: number; cursor?: EmailSearchCursor; mailboxId?: string }): Promise<EmailSearchResult[]> {
		const { page = 1, limit: rawLimit = 25 } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const { conditions, params } = buildSearchConditions(options, "e", options.cursor && options.mailboxId ? { cursor: options.cursor, mailboxId: options.mailboxId } : undefined);

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const offset = (page - 1) * limit;

		const query = `
			SELECT e.id, e.subject, e.ai_title, e.sender, e.recipient, e.cc, e.bcc, e.date,
				e.read, e.starred, e.in_reply_to, e.email_references,
				e.thread_id, e.folder_id,
				SUBSTR(e.body, 1, 300) as snippet,
				f.name as folder_name
			FROM emails e
			LEFT JOIN folders f ON e.folder_id = f.id
			${where}
			ORDER BY COALESCE(e.date, '') DESC, e.id ASC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(limit, offset);

		const result = this.ctx.storage.sql.exec(query, ...params);
		return [...result].map((row: any) => ({
			...row,
			id: String(row.id), subject: String(row.subject ?? ""), date: String(row.date ?? ""),
			sender: String(row.sender ?? ""), recipient: String(row.recipient ?? ""),
			read: !!row.read,
			starred: !!row.starred,
		}));
	}

	/**
	 * Count total search results matching the given filters (for pagination).
	 */
	async countSearchResults(options: EmailSearchFilters) {
		const { conditions, params } = buildSearchConditions(options);

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const query = `SELECT COUNT(*) as total FROM emails ${where}`;

		const row = [...this.ctx.storage.sql.exec(query, ...params)][0] as
			| { total: number }
			| undefined;
		return row?.total ?? 0;
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		const normalized = subject
			.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
			.trim()
			.toLowerCase();

		if (!normalized) return null;

		const result = this.ctx.storage.sql.exec(
			`SELECT thread_id, subject,
			        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
			        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
			 FROM emails
			 WHERE thread_id IS NOT NULL
			   AND thread_id != id
			   AND date >= datetime('now', '-7 days')
			 GROUP BY thread_id
			 ORDER BY MAX(date) DESC
			 LIMIT 50`,
		);

		const normalizedSender = senderAddress?.toLowerCase().trim();

		for (const row of result) {
			const rowSubject = String((row as any).subject || "")
				.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
				.trim()
				.toLowerCase();
			if (rowSubject !== normalized) continue;

			if (normalizedSender) {
				const threadSenders = String((row as any).senders || "");
				const threadRecipients = String((row as any).recipients || "");
				const allParticipants = `${threadSenders},${threadRecipients}`;
				if (!allParticipants.includes(normalizedSender)) {
					continue;
				}
			}

			return String((row as any).thread_id);
		}
		return null;
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/**
	 * Check if the mailbox has exceeded the send rate limit.
	 * Limits: 20 emails per hour, 100 per day per mailbox.
	 * Returns null if under limit, or an error message string if exceeded.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 hour')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 day')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
		trackingToken?: string,
	) {
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;
		if (trackingToken && (!isSent || !email.track_opens || !OPEN_TOKEN_PATTERN.test(trackingToken))) {
			throw new Error("Invalid tracking metadata for outgoing email");
		}

		// Sent emails are always read — the sender obviously knows what they wrote.
		// This prevents sent replies from inflating thread_unread_count.
		this.ctx.storage.transactionSync(() => {
			this.db
				.insert(schema.emails)
				.values({
					id: email.id,
					folder_id: folderId,
					subject: email.subject,
					sender: email.sender,
					recipient: email.recipient,
					cc: email.cc ?? null,
					bcc: email.bcc ?? null,
					date: email.date,
					read: isSent ? 1 : (email.read ? 1 : 0),
					starred: email.starred ? 1 : 0,
					body: email.body,
					in_reply_to: email.in_reply_to ?? null,
					email_references: email.email_references ?? null,
					thread_id: email.thread_id ?? null,
					message_id: email.message_id ?? null,
					raw_headers: email.raw_headers ?? null,
					track_opens: email.track_opens ? 1 : 0,
				})
				.run();

			if (attachments.length > 0) {
				this.db.insert(schema.attachments).values(attachments).run();
			}
			if (trackingToken) {
				const sentAt = Date.parse(email.date);
				this.db.insert(schema.emailTracking).values({
					email_id: email.id, token: trackingToken, sent_at: Number.isFinite(sentAt) ? sentAt : Date.now(),
				}).run();
			}
		});
	}
}
