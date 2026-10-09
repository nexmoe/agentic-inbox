import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { emailListKey, flattenEmailPages, nextEmailPage, normalizeEmailPage, patchEmailPages } from "../app/lib/email-pages.ts";

const email = (id, mailbox_id = "one@example.com") => ({ id, mailbox_id, read: false, thread_count: 1, thread_unread_count: 1 });

test("infinite lists deduplicate overlapping pages without dropping another mailbox's email", () => {
	const first = email("same-id");
	const otherMailbox = email("same-id", "two@example.com");
	const pages = [
		{ emails: [first, email("second")], totalCount: 4 },
		{ emails: [{ ...first, read: true }, otherMailbox, email("last")], totalCount: 4 },
	];
	assert.deepEqual(flattenEmailPages(pages), [first, pages[0].emails[1], otherMailbox, pages[1].emails[2]]);
	assert.notEqual(emailListKey(first), emailListKey(otherMailbox));
	assert.deepEqual(flattenEmailPages(undefined), []);
});

test("numbered pages stop at the total or an unexpectedly empty page", () => {
	assert.equal(nextEmailPage({ emails: [email("one")], totalCount: 51 }, 1), 2);
	assert.equal(nextEmailPage({ emails: [email("one")], totalCount: 51 }, 2), 3);
	assert.equal(nextEmailPage({ emails: [email("one")], totalCount: 51 }, 3), undefined);
	assert.equal(nextEmailPage({ emails: [email("one")], totalCount: 25 }, 1), undefined);
	assert.equal(nextEmailPage({ emails: [], totalCount: 200 }, 2), undefined);
});

test("legacy array responses are a single complete page", () => {
	const emails = [email("one")];
	assert.deepEqual(normalizeEmailPage(emails), { emails, totalCount: 1 });
	assert.deepEqual(normalizeEmailPage({ emails, totalCount: 80 }), { emails, totalCount: 80 });
});

test("optimistic updates reach later pages and preserve cursors and the rollback snapshot", () => {
	const cached = {
		pages: [
			{ emails: [email("first")], totalCount: 70, nextCursor: "cursor-25" },
			{ emails: [email("target"), email("target", "two@example.com")], totalCount: 70, nextCursor: "cursor-50" },
		],
		pageParams: ["", "cursor-25"],
	};
	const client = new QueryClient();
	const key = ["unified-emails", "infinite", "inbox", false];
	client.setQueryData(key, cached);
	const snapshot = client.getQueryData(key);
	client.setQueryData(key, patchEmailPages(snapshot, "one@example.com", "target", { read: true }));
	const updated = client.getQueryData(key);
	assert.equal(updated.pages[1].emails[0].read, true);
	assert.equal(updated.pages[1].emails[0].thread_unread_count, 0);
	assert.equal(updated.pages[1].emails[1].read, false);
	assert.equal(updated.pages[1].nextCursor, "cursor-50");
	assert.deepEqual(updated.pageParams, ["", "cursor-25"]);
	assert.equal(snapshot.pages[1].emails[0].read, false);
	client.setQueryData(key, snapshot);
	assert.equal(client.getQueryData(key).pages[1].emails[0].read, false);
	client.clear();
});

test("single mailbox and search pages without mailbox IDs can be patched", () => {
	const cached = { pages: [{ emails: [{ ...email("target"), mailbox_id: undefined }], totalCount: 1 }], pageParams: [1] };
	const updated = patchEmailPages(cached, "one@example.com", "target", { starred: true });
	assert.equal(updated.pages[0].emails[0].starred, true);
	assert.deepEqual(updated.pageParams, [1]);
	assert.equal(patchEmailPages(undefined, "one@example.com", "target", { read: true }), undefined);
});

test("marking a thread's latest message read does not clear other unread messages", () => {
	const cached = { pages: [{ emails: [{ ...email("thread"), thread_count: 3, thread_unread_count: 2 }], totalCount: 1 }], pageParams: [1] };
	assert.equal(patchEmailPages(cached, "one@example.com", "thread", { read: true }).pages[0].emails[0].thread_unread_count, 2);
});
