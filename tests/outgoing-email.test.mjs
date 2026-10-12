import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { sendEmail } from "../workers/email-sender.ts";

const bundle = await build({
	entryPoints: ["tests/fixtures/outgoing-worker.ts"], bundle: true, write: false, format: "esm",
	platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
	banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
});
const payload = {
	from: { email: "team@example.com", name: "Synthetic sender" },
	to: ["recipient@example.net", "second@example.net"], cc: "copy@example.net", bcc: "blind@example.net",
	subject: "Synthetic outbound test", html: "<p>Synthetic test body</p>", text: "Synthetic test body",
	attachments: [{ content: "dGVzdA==", filename: "test.txt", type: "text/plain", disposition: "attachment" }],
};
const paths = ["", "/original/reply", "/original/forward"];

async function fixture() {
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28",
		compatibilityFlags: ["nodejs_compat"], durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true } }, r2Buckets: ["BUCKET"],
		serviceBindings: { DELIVERY: async () => { await gate; return new Response("Accepted"); } },
	});
	const fetch = (path, init) => runtime.dispatchFetch(`https://test${path}`, init);
	assert.equal((await fetch("/__seed", { method: "POST" })).status, 204);
	const base = "/api/v1/mailboxes/team@example.com/emails";
	const send = (suffix, mode = "success", code) => fetch(`${base}${suffix}`, {
		method: "POST", headers: { "Content-Type": "application/json", "x-test-delivery": mode, ...(code ? { "x-test-code": code } : {}) }, body: JSON.stringify(payload),
	});
	const get = async path => { const response = await fetch(path); assert.equal(response.status, 200); return response.json(); };
	return { runtime, fetch, get, send, base, release, close: async () => { release(); await runtime.dispose(); } };
}

test("compose, reply and forward report delivery failures without creating Sent mail or removing drafts", async () => {
	const f = await fixture();
	try {
		for (const path of paths) {
			const response = await f.send(path, "failure");
			assert.equal(response.status, 400, "Unverified sending domains must be visible to the composer");
			const body = await response.json();
			assert.match(body.error, /sender domain/i);
			assert(!JSON.stringify(body).includes("Private upstream diagnostic"));
			assert.equal((await f.get(`${f.base}?folder=sent`)).totalCount, 0);
			assert.equal((await f.get(`${f.base}?folder=draft`)).totalCount, 1);
			assert.equal(await f.get("/__attachments"), 0, "Rejected sends must not leave orphaned attachments");
		}
		assert.equal((await f.get(`${f.base}/original`)).read, false, "A failed reply must not mark its thread read");
	} finally { await f.close(); }
});

test("compose waits for provider acceptance before returning success and adding Sent mail", async () => {
	const f = await fixture();
	try {
		let settled = false;
		const sending = f.send("", "pending").then(response => { settled = true; return response; });
		for (let attempt = 0; attempt < 100 && !(await f.get("/__calls")).length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal((await f.get("/__calls")).length, 1);
		assert.equal(settled, false);
		assert.equal((await f.get(`${f.base}?folder=sent`)).totalCount, 0);
		f.release();
		const response = await sending;
		assert.equal(response.status, 200);
		assert.equal((await response.json()).status, "sent");
		assert.equal((await f.get(`${f.base}?folder=sent`)).totalCount, 1);
	} finally { await f.close(); }
});

test("an empty or malformed provider acknowledgement cannot report a successful send", async () => {
	for (const result of [undefined, {}, { messageId: "" }]) {
		await assert.rejects(sendEmail({ send: async () => result }, payload), error => {
			assert.equal(error.status, 502);
			assert.match(error.message, /could not accept/);
			return true;
		});
	}
});

test("successful sends preserve recipients, attachments and reply threading", async () => {
	const f = await fixture();
	try {
		for (const path of paths) assert.equal((await f.send(path)).status, 200);
		const messages = await f.get("/__calls");
		assert.equal(messages.length, 3);
		for (const message of messages) {
			assert.deepEqual(message.from, payload.from);
			assert.deepEqual(message.to, payload.to);
			for (const field of ["cc", "bcc", "html", "text"]) assert.equal(message[field], payload[field]);
			assert.deepEqual(message.attachments, payload.attachments);
		}
		assert.equal(messages[1].headers["In-Reply-To"], "<original@example.net>");
		assert.equal(messages[1].headers.References, "<original@example.net>");
		assert.equal(messages[2].headers, undefined);
		const sent = await f.get(`${f.base}?folder=sent`);
		assert.equal(sent.totalCount, 3);
		for (const email of sent.emails) {
			const stored = await f.get(`${f.base}/${email.id}`);
			assert.equal(stored.attachments[0].filename, "test.txt");
		}
	} finally { await f.close(); }
});

test("provider rate limits and unknown failures return actionable JSON without private diagnostics", async () => {
	const f = await fixture();
	try {
		for (const [code, status] of [["E_RATE_LIMIT_EXCEEDED", 429], ["E_UNKNOWN", 502]]) {
			const response = await f.send("", "failure", code);
			assert.equal(response.status, status);
			const body = await response.json();
			assert.equal(typeof body.error, "string");
			assert(!body.error.includes("Private upstream diagnostic"));
		}
		assert.equal((await f.get(`${f.base}?folder=sent`)).totalCount, 0);
	} finally { await f.close(); }
});
