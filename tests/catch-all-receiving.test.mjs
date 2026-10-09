import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const mailboxes = ["team@example.com", "team@example.net"];
const catchAll = { "example.com": mailboxes[0], "example.net": mailboxes[1] };

async function fixture(routing = catchAll) {
	const bundle = await build({
		entryPoints: ["tests/fixtures/receive-worker.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
		banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	});
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true }, EMAIL_AGENT: { className: "ReceiptAgent", useSQLite: true } },
		r2Buckets: ["BUCKET"], bindings: { EMAIL_ADDRESSES: mailboxes, EMAIL_CATCH_ALL: routing, EMAIL_FORWARDING: {} },
	});
	const bucket = await runtime.getR2Bucket("BUCKET");
	for (const email of mailboxes) await bucket.put(`mailboxes/${email}.json`, "{}");
	const get = async path => {
		const response = await runtime.dispatchFetch(`https://test${path}`);
		assert.equal(response.status, 200);
		return response.json();
	};
	const receive = async (to, subject, headerTo = to) => {
		const raw = ["From: Sender <sender@example.org>", `To: ${headerTo}`, `Subject: ${subject}`, `Message-ID: <${crypto.randomUUID()}@example.org>`, "Content-Type: text/plain; charset=utf-8", "", `Complete body: ${subject}`].join("\r\n");
		const response = await runtime.dispatchFetch(`https://test/__receive?${new URLSearchParams({ to })}`, { method: "POST", body: raw });
		assert.equal(response.status, 204);
	};
	return { get, receive, bucket, close: () => runtime.dispose() };
}

test("catch-all stores aliases in the configured domain mailbox and triggers its Agent", async () => {
	const f = await fixture();
	try {
		await f.receive("BILLING@EXAMPLE.COM", "First alias", "billing@example.com");
		await f.receive("sales@example.net", "Second domain");
		await f.receive("team@example.com", "Original primary");
		await f.receive("team+private@example.com", "Blind-copy alias", "outside@example.org");
		const all = await f.get("/api/v1/emails?folder=inbox");
		assert.equal(all.totalCount, 4);
		for (const message of all.emails) {
			const expected = message.subject === "Second domain" ? mailboxes[1] : mailboxes[0];
			assert.equal(message.mailbox_id, expected);
			const detail = await f.get(`/api/v1/mailboxes/${expected}/emails/${message.id}`);
			assert.equal(detail.body.trim(), `Complete body: ${message.subject}`);
			assert.equal(detail.recipient, message.subject === "Blind-copy alias" ? "outside@example.org" : message.subject === "First alias" ? "billing@example.com" : message.subject === "Second domain" ? "sales@example.net" : mailboxes[0]);
			const event = await f.bucket.get(`receipt-events/${expected}/${message.id}.json`);
			assert(event, "Receipt triggers the Agent belonging to the storage mailbox");
			assert.equal((await event.json()).mailboxId, expected);
		}
		assert.equal((await f.get(`/api/v1/mailboxes/${mailboxes[0]}/emails?folder=inbox`)).totalCount, 3);
		assert.equal((await f.get(`/api/v1/mailboxes/${mailboxes[1]}/emails?folder=inbox`)).totalCount, 1);
		assert.deepEqual((await f.bucket.list({ prefix: "mailboxes/" })).objects.map(o => o.key).sort(), mailboxes.map(email => `mailboxes/${email}.json`).sort(), "Aliases do not create extra mailboxes");
	} finally { await f.close(); }
});

test("catch-all rejects unknown domains, subdomains, and unconfigured destination mailboxes", async () => {
	const f = await fixture({ ...catchAll, "outside.org": "unconfigured@example.com" });
	try {
		for (const to of ["alias@unknown.org", "alias@sub.example.com", "alias@example.com.evil.org", "alias@outside.org"]) await f.receive(to, to);
		assert.equal((await f.get("/api/v1/emails?folder=inbox")).totalCount, 0);
		assert.equal((await f.bucket.list({ prefix: "receipt-events/" })).objects.length, 0);
	} finally { await f.close(); }
});

test("without catch-all configuration only configured exact addresses are received", async () => {
	const f = await fixture({});
	try {
		await f.receive("alias@example.com", "Not configured");
		await f.receive("team@example.com", "Primary stays supported");
		const all = await f.get("/api/v1/emails?folder=inbox");
		assert.equal(all.totalCount, 1);
		assert.equal(all.emails[0].mailbox_id, mailboxes[0]);
		assert.equal(all.emails[0].subject, "Primary stays supported");
	} finally { await f.close(); }
});

test("mailbox discovery identifies catch-all domains while preserving mailbox addresses", async () => {
	const f = await fixture({
		"EXAMPLE.COM": " TEAM@EXAMPLE.COM ",
		"other.org": mailboxes[0],
		"unknown.org": "missing@example.org",
	});
	try {
		const boxes = await f.get("/api/v1/mailboxes");
		const catchAllBox = boxes.find((box) => box.id === mailboxes[0]);
		assert.equal(catchAllBox.email, mailboxes[0]);
		assert.deepEqual(catchAllBox.catchAllDomains, ["example.com", "other.org"]);
		const exactBox = boxes.find((box) => box.id === mailboxes[1]);
		assert.equal(exactBox.email, mailboxes[1]);
		assert.deepEqual(exactBox.catchAllDomains, []);
		assert.equal(boxes.length, mailboxes.length);
	} finally { await f.close(); }
});
