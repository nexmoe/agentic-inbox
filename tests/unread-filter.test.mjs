import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

async function createRuntime() {
	const bundle = await build({
		entryPoints: ["tests/fixtures/unread-worker.ts"], bundle: true, write: false,
		format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
		banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	});
	return new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true } }, r2Buckets: ["BUCKET"],
	});
}

test("unread APIs count and paginate complete conversations, including read latest messages and grouped drafts", async () => {
	const runtime = await createRuntime();
	const get = async (path) => {
		const response = await runtime.dispatchFetch(`https://test${path}`);
		assert.equal(response.status, 200);
		return response.json();
	};
	try {
		const seed = await runtime.dispatchFetch("https://test/__seed", { method: "POST", body: JSON.stringify({
			"a@example.com": [
				{ id: "old-unread", subject: "Proposal", thread_id: "thread-a", date: "2026-10-01", read: false },
				{ id: "latest-read", subject: "Re: Proposal", thread_id: "thread-a", date: "2026-10-09", read: true },
				{ id: "read-only", subject: "Read conversation", thread_id: "thread-b", date: "2026-10-10", read: true },
				{ id: "legacy-unread", subject: "Legacy topic", date: "2026-10-02", read: false },
				{ id: "legacy-read", subject: "Re: Legacy topic", date: "2026-10-08", read: true },
				{ id: "draft-old", subject: "Draft", folder: "draft", in_reply_to: "latest-read", date: "2026-10-01", read: false },
				{ id: "draft-new", subject: "Draft", folder: "draft", in_reply_to: "latest-read", date: "2026-10-09", read: true },
				{ id: "draft-read", subject: "Read draft", folder: "draft", date: "2026-10-10", read: true },
			],
			"b@example.com": [{ id: "other-unread", subject: "Other mailbox", date: "2026-10-03", read: false }],
		}) });
		assert.equal(seed.status, 204);
		const path = "/api/v1/mailboxes/a@example.com/emails";
		const first = await get(`${path}?folder=inbox&threaded=true&unread=true&limit=1&page=1`);
		assert.equal(first.totalCount, 2);
		assert.deepEqual(first.emails.map((email) => email.id), ["latest-read"]);
		assert.equal(first.emails[0].thread_count, 2);
		assert.equal(first.emails[0].thread_unread_count, 1);
		const second = await get(`${path}?folder=inbox&threaded=true&unread=true&limit=1&page=2`);
		assert.equal(second.totalCount, 2);
		assert.deepEqual(second.emails.map((email) => email.id), ["legacy-read"]);
		assert.equal(second.emails[0].thread_unread_count, 1);
		assert.equal((await get(`${path}?folder=inbox&threaded=true`)).totalCount, 3);
		const drafts = await get(`${path}?folder=draft&threaded=true&unread=true`);
		assert.equal(drafts.totalCount, 1);
		assert.deepEqual(drafts.emails.map((email) => email.id), ["draft-new"]);
		const regular = await get(`${path}?folder=inbox&unread=true`);
		assert.equal(regular.totalCount, 2);
		assert.ok(regular.emails.every((email) => !email.read));
		const unified = await get("/api/v1/emails?folder=inbox&unread=true&limit=1");
		assert.equal(unified.totalCount, 3);
		assert.equal(unified.emails[0].mailbox_id, "b@example.com");
		const next = await get(`/api/v1/emails?folder=inbox&unread=true&limit=1&cursor=${encodeURIComponent(unified.nextCursor)}`);
		assert.deepEqual(next.emails.map((email) => email.id), ["legacy-unread"]);
		assert.equal((await runtime.dispatchFetch(`https://test/api/v1/emails?folder=inbox&cursor=${encodeURIComponent(unified.nextCursor)}`)).status, 400);
		const read = await runtime.dispatchFetch(`https://test${path}/old-unread`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
		assert.equal(read.status, 200);
		assert.equal((await get(`${path}?folder=inbox&threaded=true&unread=true`)).totalCount, 1);
		assert.equal((await get("/api/v1/emails?folder=inbox&unread=true")).totalCount, 2);
	} finally { await runtime.dispose(); }
});

test("unread drafts and replies outside Inbox do not make read Inbox conversations appear unread", async () => {
	const runtime = await createRuntime();
	const get = async (path) => {
		const response = await runtime.dispatchFetch(`https://test${path}`);
		assert.equal(response.status, 200);
		return response.json();
	};
	try {
		const seed = await runtime.dispatchFetch("https://test/__seed", { method: "POST", body: JSON.stringify({
			"a@example.com": [
				{ id: "read-with-draft", subject: "Read proposal", thread_id: "draft-thread", date: "2026-10-08", read: true },
				{ id: "unread-draft", subject: "Re: Read proposal", thread_id: "draft-thread", in_reply_to: "read-with-draft", folder: "draft", date: "2026-10-09", read: false },
				{ id: "read-with-archive", subject: "Read conversation", thread_id: "archive-thread", date: "2026-10-08", read: true },
				{ id: "unread-archive", subject: "Re: Read conversation", thread_id: "archive-thread", folder: "archive", date: "2026-10-09", read: false },
			],
		}) });
		assert.equal(seed.status, 204);
		const path = "/api/v1/mailboxes/a@example.com/emails";
		const inbox = await get(`${path}?folder=inbox&threaded=true`);
		assert.equal(inbox.totalCount, 2);
		assert.ok(inbox.emails.every((email) => email.read && email.thread_unread_count === 0));
		assert.ok(inbox.emails.every((email) => email.thread_count === 2), "Full conversation metadata still includes other folders");
		const unreadInbox = await get(`${path}?folder=inbox&threaded=true&unread=true`);
		assert.equal(unreadInbox.totalCount, 0);
		assert.deepEqual(unreadInbox.emails, []);
		const unified = await get("/api/v1/emails?folder=inbox&unread=true");
		assert.equal(unified.totalCount, 0);
		assert.deepEqual(unified.emails, []);
		for (const folder of ["draft", "archive"]) {
			const ownFolder = await get(`${path}?folder=${folder}&threaded=true&unread=true`);
			assert.equal(ownFolder.totalCount, 1);
			assert.equal(ownFolder.emails[0].thread_unread_count, 1);
		}
	} finally { await runtime.dispose(); }
});
