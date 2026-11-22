import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { decodeUnifiedCursor, listUnifiedEmails, unifiedEmailsQuery } from "../workers/lib/unified-inbox.ts";
import { countThreadedEmailsQuery } from "../workers/lib/threaded-emails.ts";
import { applyMigrations, mailboxMigrations } from "../workers/durableObject/migrations.ts";

test("AI title migration upgrades existing mailboxes once without changing original messages", () => {
	const db = new DatabaseSync(":memory:");
	const sql = { exec: (query, ...params) => {
		if (/^\s*SELECT\b/i.test(query)) return db.prepare(query).all(...params);
		db.exec(query);
		return [];
	} };
	const storage = { transactionSync: (callback) => {
		db.exec("BEGIN");
		try { const result = callback(); db.exec("COMMIT"); return result; }
		catch (error) { db.exec("ROLLBACK"); throw error; }
	} };
	try {
		applyMigrations(sql, mailboxMigrations.slice(0, -1), storage);
		db.prepare("INSERT INTO emails (id, folder_id, subject, body) VALUES (?, ?, ?, ?)").run("old", "inbox", "Original subject", "Original full body");
		applyMigrations(sql, mailboxMigrations, storage);
		applyMigrations(sql, mailboxMigrations, storage);
		const email = db.prepare("SELECT subject, body, ai_title FROM emails WHERE id = ?").get("old");
		assert.deepEqual({ ...email }, { subject: "Original subject", body: "Original full body", ai_title: null });
		assert.equal(db.prepare("SELECT COUNT(*) AS count FROM d1_migrations WHERE name = ?").get("9_add_ai_title").count, 1);
	} finally { db.close(); }
});

function fixture(data) {
	const databases = new Map();
	for (const [mailboxId, messages] of Object.entries(data)) {
		const db = new DatabaseSync(":memory:");
		db.exec("CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT); INSERT INTO folders VALUES ('inbox', 'inbox'), ('sent', 'sent'), ('draft', 'draft')");
		db.exec(`CREATE TABLE emails (id TEXT PRIMARY KEY, subject TEXT, ai_title TEXT, sender TEXT, recipient TEXT, cc TEXT, bcc TEXT, date TEXT,
		 read INTEGER, starred INTEGER, track_opens INTEGER, in_reply_to TEXT, email_references TEXT, thread_id TEXT, folder_id TEXT, body TEXT)`);
		const insert = db.prepare("INSERT INTO emails (id, date, folder_id, body, subject, ai_title, read, thread_id, in_reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
		for (const message of messages) insert.run(message.id, message.date, message.folder ?? "inbox", message.body ?? "Full email body", message.subject === undefined ? message.id : message.subject, message.title ?? null, message.read ? 1 : 0, message.thread_id ?? null, message.in_reply_to ?? null);
		databases.set(mailboxId, db);
	}
	const fetchSizes = [];
	const page = async (limit, cursor, folder = "inbox", unreadOnly = false) => listUnifiedEmails([...databases.keys()], { folder, limit, cursor, unreadOnly }, async (mailboxId, size, before) => {
		fetchSizes.push(size);
		const db = databases.get(mailboxId);
		const query = unifiedEmailsQuery(folder, mailboxId, size, before, unreadOnly);
		const count = countThreadedEmailsQuery(folder, unreadOnly);
		return { emails: db.prepare(query.sql).all(...query.params), totalCount: db.prepare(count.sql).get(...count.params).total };
	});
	return { page, fetchSizes, databases, close: () => { for (const db of databases.values()) db.close(); } };
}

test("merges all mailboxes by date and keeps mailbox identity when email IDs overlap", async () => {
	const f = fixture({
		"a@example.com": [{ id: "same", date: "2026-10-08" }, { id: "sent", date: "2026-10-10", folder: "sent" }],
		"b@example.com": [{ id: "same", date: "2026-10-09" }],
		"empty@example.com": [],
	});
	try {
		const page = await f.page(25);
		assert.deepEqual(page.emails.map((email) => email.mailbox_id), ["b@example.com", "a@example.com"]);
		assert.equal(page.totalCount, 2);
		assert.equal(page.nextCursor, null);
		assert.equal((await f.page(25, undefined, "sent")).emails[0].id, "sent");
	} finally { f.close(); }
});

test("unified pages carry saved AI titles separately from original subjects", async () => {
	const f = fixture({ "a@example.com": [{ id: "titled", date: "2026-10-09", subject: "Original subject", title: "周五前审核方案" }, { id: "pending", date: "2026-10-08" }] });
	try {
		const page = await f.page(25);
		assert.equal(page.emails[0].ai_title, "周五前审核方案");
		assert.equal(page.emails[0].subject, "Original subject");
		assert.equal(page.emails[1].ai_title, null);
	} finally { f.close(); }
});

test("thread representatives stay unique across cursor pages, subject changes and equal timestamps", async () => {
	const f = fixture({ "a@example.com": [
		{ id: "older", date: "2026-10-01", subject: "Proposal", thread_id: "thread-a" },
		{ id: "latest-b", date: "2026-10-09", subject: "Re: Proposal", thread_id: "thread-a" },
		{ id: "latest-a", date: "2026-10-09", subject: "Updated proposal", thread_id: "thread-a", read: true, title: "Latest title" },
		{ id: "other", date: "2026-10-08", subject: "Proposal", thread_id: "thread-b" },
	] });
	try {
		const first = await f.page(1, undefined, "inbox", true);
		assert.equal(first.totalCount, 2);
		assert.equal(first.emails[0].id, "latest-a");
		assert.equal(first.emails[0].ai_title, "Latest title");
		assert.equal(first.emails[0].thread_count, 3);
		assert.equal(first.emails[0].thread_unread_count, 2);
		const second = await f.page(1, decodeUnifiedCursor(first.nextCursor, "inbox", true), "inbox", true);
		assert.deepEqual(second.emails.map((email) => email.id), ["other"]);
		assert.equal(second.nextCursor, null);
	} finally { f.close(); }
});

test("legacy subject groups and independent messages without subjects have matching conversation counts", async () => {
	const f = fixture({ "a@example.com": [
		{ id: "legacy-old", date: "2026-10-01", subject: "Proposal" },
		{ id: "legacy-new", date: "2026-10-09", subject: "Re: Proposal", read: true },
		{ id: "blank-a", date: "2026-10-03", subject: "" },
		{ id: "blank-b", date: "2026-10-02", subject: "" },
		{ id: "null-a", date: null, subject: null },
		{ id: "null-b", date: null, subject: null },
	] });
	try {
		const page = await f.page(25);
		assert.equal(page.totalCount, 5);
		assert.deepEqual(page.emails.map((email) => email.id), ["legacy-new", "blank-a", "blank-b", "null-a", "null-b"]);
		assert.equal(page.emails[0].thread_count, 2);
		assert.equal((await f.page(25, undefined, "inbox", true)).totalCount, 5);
	} finally { f.close(); }
});

test("SQL cursor traverses identical timestamps across mailboxes with no missing or duplicate emails", async () => {
	const f = fixture({
		"z@example.com": [{ id: "1", date: "2026-10-09" }, { id: "2", date: "2026-10-09" }],
		"a@example.com": [{ id: "1", date: "2026-10-09" }, { id: "2", date: "2026-10-09" }, { id: "old", date: null }],
	});
	try {
		const seen = [];
		let cursor;
		do {
			const page = await f.page(2, cursor);
			seen.push(...page.emails.map((email) => `${email.mailbox_id}/${email.id}`));
			cursor = page.nextCursor ? decodeUnifiedCursor(page.nextCursor, "inbox") : undefined;
		} while (cursor);
		assert.deepEqual(seen, ["a@example.com/1", "a@example.com/2", "z@example.com/1", "z@example.com/2", "a@example.com/old"]);
		assert.ok(f.fetchSizes.every((size) => size === 3));
	} finally { f.close(); }
});

test("new arrivals do not shift later pages or make them repeat rows", async () => {
	const f = fixture({ "a@example.com": [1, 2, 3, 4].map((day) => ({ id: String(day), date: `2026-10-0${day}` })) });
	try {
		const first = await f.page(2);
		f.databases.get("a@example.com").prepare("INSERT INTO emails (id, date, folder_id) VALUES (?, ?, ?)").run("new", "2026-10-09", "inbox");
		const second = await f.page(2, decodeUnifiedCursor(first.nextCursor, "inbox"));
		assert.deepEqual(second.emails.map((email) => email.id), ["2", "1"]);
		assert.equal(second.totalCount, 5);
	} finally { f.close(); }
});

test("rejects malformed and cross-folder cursors; SQL parameters keep cursor content literal", () => {
	for (const value of ["!bad", btoa("{}"), "a".repeat(2049), btoa(JSON.stringify({ date: "x", mailboxId: "a", id: "b", folder: "sent" }))]) {
		assert.throws(() => decodeUnifiedCursor(value, "inbox"), /Invalid cursor/);
	}
	const query = unifiedEmailsQuery("inbox", "a", 999, { date: "' OR 1=1 --", mailboxId: "a", id: "' DROP TABLE emails", folder: "inbox" });
	assert.doesNotMatch(query.sql, /DROP TABLE|1=1/);
	assert.equal(query.params[1], 51);
});

test("an unavailable mailbox fails the unified list instead of silently hiding its emails", async () => {
	await assert.rejects(listUnifiedEmails(["healthy", "broken"], { folder: "inbox", limit: 25 }, async (id) => {
		if (id === "broken") throw new Error("mailbox unavailable");
		return { emails: [], totalCount: 0 };
	}), /mailbox unavailable/);
});

test("unread pagination filters before limiting and carries matching counts across mailboxes", async () => {
	const f = fixture({
		"a@example.com": [{ id: "read-new", date: "2026-10-10", read: true }, { id: "unread", date: "2026-10-09" }],
		"b@example.com": [{ id: "read", date: "2026-10-08", read: true }, { id: "unread-old", date: "2026-10-07" }],
	});
	try {
		const first = await f.page(1, undefined, "inbox", true);
		assert.deepEqual(first.emails.map((email) => email.id), ["unread"]);
		assert.equal(first.totalCount, 2);
		assert.throws(() => decodeUnifiedCursor(first.nextCursor, "inbox"), /Invalid cursor/);
		const second = await f.page(1, decodeUnifiedCursor(first.nextCursor, "inbox", true), "inbox", true);
		assert.deepEqual(second.emails.map((email) => email.id), ["unread-old"]);
		assert.equal(second.nextCursor, null);
		const all = await f.page(1);
		assert.equal(all.totalCount, 4);
		assert.throws(() => decodeUnifiedCursor(all.nextCursor, "inbox", true), /Invalid cursor/);
	} finally { f.close(); }
});
