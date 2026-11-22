import { Folders } from "../../shared/folders.ts";
import type { UnifiedEmailCursor } from "../../shared/unified-inbox";

const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

// Explicit thread IDs stay separate. Legacy messages fall back to their subject.
// DISTINCT keeps a thread's mapping unique when its subject changes.
function conversationCtes(countOnly = false) {
	return `folder_emails AS (
		SELECT ${countOnly ? "id, thread_id, read," : "*,"}
			COALESCE(thread_id, id) AS raw_thread_id,
			${NORMALIZED_SUBJECT_SQL} AS normalized_subject
		FROM emails
		WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
	),
	thread_to_conversation AS (
		SELECT DISTINCT raw_thread_id,
			CASE
				WHEN thread_id IS NOT NULL THEN raw_thread_id
				WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
				ELSE raw_thread_id
			END AS conversation_id
		FROM folder_emails
	)`;
}

type Pagination = { offset: number } | { mailboxId: string; cursor?: UnifiedEmailCursor };

/** Rank complete conversations before applying the unread filter, cursor or limit. */
export function threadedEmailsQuery(folder: string, limit: number, unreadOnly = false, pagination: Pagination = { offset: 0 }) {
	const params: (string | number)[] = [folder, limit];
	const isDraft = folder === Folders.DRAFT;
	const alias = isDraft ? "lp" : "lif";
	let after = "";
	let page = "LIMIT ?2";
	if ("offset" in pagination) {
		params.push(pagination.offset);
		page += " OFFSET ?3";
	} else if (pagination.cursor) {
		const { mailboxId, cursor } = pagination;
		const sameDate = mailboxId > cursor.mailboxId ? "1" : mailboxId < cursor.mailboxId ? "0" : `${alias}.id > ?5`;
		after = `AND (COALESCE(${alias}.date, '') < ?3 OR (COALESCE(${alias}.date, '') = ?4 AND (${sameDate})))`;
		params.push(cursor.date, cursor.date);
		if (mailboxId === cursor.mailboxId) params.push(cursor.id);
	}

	if (isDraft) {
		return {
			sql: `WITH folder_emails AS (
				SELECT *, COALESCE(in_reply_to, id) AS draft_group_key
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			draft_stats AS (
				SELECT draft_group_key, COUNT(*) AS thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS thread_unread_count,
					GROUP_CONCAT(DISTINCT sender) AS participants
				FROM folder_emails GROUP BY draft_group_key
			),
			latest_per_group AS (
				SELECT fe.*, ROW_NUMBER() OVER (
					PARTITION BY draft_group_key ORDER BY COALESCE(date, '') DESC, id ASC
				) AS rn
				FROM folder_emails fe
			)
			SELECT lp.id, lp.subject, lp.ai_title, lp.sender, lp.recipient, lp.cc, lp.bcc, lp.date,
				lp.read, lp.starred, lp.track_opens, lp.thread_id, lp.folder_id,
				lp.in_reply_to, lp.email_references, SUBSTR(lp.body, 1, 300) AS snippet,
				ds.thread_count, ds.thread_unread_count, ds.participants
			FROM latest_per_group lp
			JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
			WHERE lp.rn = 1 ${unreadOnly ? "AND ds.thread_unread_count > 0" : ""} ${after}
			ORDER BY COALESCE(lp.date, '') DESC, lp.id ASC ${page}`,
			params,
		};
	}

	return {
		sql: `WITH ${conversationCtes()},
		all_emails_with_conversation AS (
			SELECT e.*, COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) AS conversation_id
			FROM emails e
			LEFT JOIN thread_to_conversation tc ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
		),
		conversation_stats AS (
			SELECT conversation_id, COUNT(*) AS thread_count,
				SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) AS thread_read_count,
				GROUP_CONCAT(DISTINCT sender) AS participants,
				SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) AS has_draft
			FROM all_emails_with_conversation
			WHERE conversation_id IN (
				SELECT DISTINCT conversation_id FROM all_emails_with_conversation
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			)
			GROUP BY conversation_id
		),
		latest_message_per_conversation AS (
			SELECT conversation_id, folder_id, ROW_NUMBER() OVER (
				PARTITION BY conversation_id ORDER BY COALESCE(date, '') DESC, id ASC
			) AS rn
			FROM all_emails_with_conversation
		),
		latest_in_folder AS (
			SELECT fe.*, COALESCE(tc.conversation_id, fe.raw_thread_id) AS conversation_id,
				SUM(CASE WHEN fe.read = 0 THEN 1 ELSE 0 END) OVER (
					PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
				) AS folder_unread_count,
				ROW_NUMBER() OVER (
					PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
					ORDER BY COALESCE(fe.date, '') DESC, fe.id ASC
				) AS rn
			FROM folder_emails fe
			LEFT JOIN thread_to_conversation tc ON fe.raw_thread_id = tc.raw_thread_id
		)
		SELECT lif.id, lif.subject, lif.ai_title, lif.sender, lif.recipient, lif.cc, lif.bcc, lif.date,
			lif.read, lif.starred, lif.track_opens, lif.thread_id, lif.folder_id,
			lif.in_reply_to, lif.email_references, SUBSTR(lif.body, 1, 300) AS snippet,
			cs.thread_count, lif.folder_unread_count AS thread_unread_count, cs.participants,
			CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
				AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
				AND cs.thread_read_count > 0 THEN 1 ELSE 0 END AS needs_reply,
			CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END AS has_draft
		FROM latest_in_folder lif
		JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
		LEFT JOIN latest_message_per_conversation lmc ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
		WHERE lif.rn = 1 ${unreadOnly ? "AND lif.folder_unread_count > 0" : ""} ${after}
		ORDER BY COALESCE(lif.date, '') DESC, lif.id ASC ${page}`,
		params,
	};
}

export function countThreadedEmailsQuery(folder: string, unreadOnly = false) {
	return {
		sql: folder === Folders.DRAFT
			? `SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) AS total FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1) ${unreadOnly ? "AND read = 0" : ""}`
			: `WITH ${conversationCtes(true)}
				SELECT COUNT(DISTINCT tc.conversation_id) AS total
				FROM folder_emails fe JOIN thread_to_conversation tc ON fe.raw_thread_id = tc.raw_thread_id
				${unreadOnly ? "WHERE fe.read = 0" : ""}`,
		params: [folder],
	};
}
