import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { automatedOpen, openFingerprint, prepareOpenTracking, trackingOrigin } from "../workers/lib/open-tracking.ts";

test("tracking is opt-in, uses a configured safe origin, and preserves message structure", () => {
	assert.deepEqual(prepareOpenTracking(undefined, "team@example.com", false, "<p>Body</p>"), { html: "<p>Body</p>" });
	for (const origin of [undefined, "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/path", "https://example.com/?token=secret", "http://example.com"]) {
		assert.equal(trackingOrigin(origin), null);
		assert.throws(() => prepareOpenTracking(origin, "team@example.com", true, "<p>Body</p>"), error => error.status === 400);
	}
	assert.equal(trackingOrigin("http://localhost:3000"), "http://localhost:3000");
	const body = '<html><body><p>Body</p></body></html>';
	const tracked = prepareOpenTracking("https://pixels.example.com", "TEAM@example.com", true, body);
	assert.match(tracked.token, /^[\w-]{43}$/);
	assert(tracked.html.startsWith("<html><body><p>Body</p><img "));
	assert(tracked.html.endsWith("</body></html>"));
	assert(tracked.html.includes(`/pixel/team%40example.com/${tracked.token}.gif`));
	assert.notEqual(prepareOpenTracking("https://pixels.example.com", "team@example.com", true, body).token, tracked.token);
	const plain = prepareOpenTracking("https://pixels.example.com", "team@example.com", true, undefined, '<script>unsafe</script>\n& text');
	assert(plain.html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
	assert(!plain.html.includes("<script>"));
});

test("automation filtering and per-message fingerprints avoid counting scanners and retaining client identifiers", async () => {
	const client = { userAgent: "Thunderbird/140.0", purpose: "", fingerprint: "hash" };
	assert.equal(automatedOpen(client, 0, 10_001), false);
	for (const patch of [{ asn: 714 }, { asn: 6185 }, { userAgent: "Mozilla/5.0" }, { userAgent: "Proofpoint URL Defense" }, { userAgent: "Googlebot" }, { purpose: "prefetch" }]) {
		assert.equal(automatedOpen({ ...client, ...patch }, 0, 60_000), true);
	}
	assert.equal(automatedOpen(client, 0, 9_999), true);
	const fingerprint = await openFingerprint("token-one", "192.0.2.1", client.userAgent);
	assert.match(fingerprint, /^[a-f0-9]{64}$/);
	assert.equal(fingerprint, await openFingerprint("token-one", "192.0.2.1", client.userAgent));
	assert.notEqual(fingerprint, await openFingerprint("token-two", "192.0.2.1", client.userAgent));
	assert(!fingerprint.includes("192.0.2.1"));
});

const bundle = await build({
	entryPoints: ["tests/fixtures/open-tracking-worker.ts"], bundle: true, write: false, format: "esm",
	platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
	define: { "import.meta.env.DEV": "false", "import.meta.env.MODE": '"production"' },
	banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	plugins: [{ name: "test-router-build", setup(build) {
		build.onResolve({ filter: /^virtual:react-router\/server-build$/ }, () => ({ path: "test-router-build", namespace: "test" }));
		build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const routes = {};" }));
	} }],
});
const base = "/api/v1/mailboxes/team@example.com/emails";
const pixel = `/pixel/team%40example.com/${"A".repeat(43)}.gif`;
const payload = { from: "team@example.com", to: "recipient@example.net", subject: "Tracked test", html: "<p>Test body</p>", text: "Test body", trackOpens: true };

async function fixture(origin = "https://public.example.com") {
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true } }, r2Buckets: ["BUCKET"],
		bindings: { OPEN_TRACKING_ORIGIN: origin, EMAIL_ADDRESSES: ["team@example.com"] },
	});
	const fetch = (path, init) => runtime.dispatchFetch(`https://public.example.com${path}`, init);
	assert.equal((await fetch("/__seed", { method: "POST" })).status, 204);
	const json = async path => { const response = await fetch(path); assert.equal(response.status, 200); return response.json(); };
	const send = (suffix = "", body = payload, headers = {}) => fetch(base + suffix, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
	return { fetch, json, send, close: () => runtime.dispose() };
}

test("new mail, replies and forwards deliver one unique pixel while keeping Sent bodies clean", async () => {
	const f = await fixture();
	try {
		assert.equal((await f.json("/api/v1/config")).openTrackingAvailable, true);
		for (const suffix of ["", "/original/reply", "/original/forward"]) {
			const sent = await f.send(suffix); assert.equal(sent.status, 200);
			const { id } = await sent.json();
			const detail = await f.json(`${base}/${id}`);
			assert.equal(detail.track_opens, true);
			assert.equal(detail.body, payload.html);
			assert.deepEqual(await f.json(`${base}/${id}/opens`), { enabled: true, openCount: 0, firstOpenedAt: null, lastOpenedAt: null });
			assert(!JSON.stringify(detail).includes("tracking_token"));
		}
		const messages = await f.json("/__calls");
		assert.equal(new Set(messages.map(message => message.html.match(/\/([\w-]{43})\.gif/)[1])).size, 3);
		for (const message of messages) {
			assert.equal((message.html.match(/<img /g) ?? []).length, 1);
			assert.equal(message.text, payload.text);
			assert(message.html.includes("https://public.example.com/pixel/"));
		}
		assert.equal((await f.send("", { ...payload, trackOpens: false })).status, 200);
		assert.equal((await f.json("/__calls")).at(-1).html, payload.html);
	} finally { await f.close(); }
});

test("public pixels remain outside Access while mailbox APIs and open statistics stay protected", async () => {
	const f = await fixture();
	try {
		const response = await f.fetch(pixel);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "image/gif");
		assert.match(response.headers.get("cache-control"), /no-store/);
		const bytes = new Uint8Array(await response.arrayBuffer());
		assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
		assert.equal(bytes[6], 1); assert.equal(bytes[8], 1);
		for (const path of [pixel.replace("A".repeat(43), "invalid"), pixel.replace("A".repeat(43), "B".repeat(43)), pixel.replace("team%40example.com", "missing%40example.com")]) {
			const unknown = await f.fetch(path); assert.equal(unknown.status, 200);
			assert.deepEqual(new Uint8Array(await unknown.arrayBuffer()), bytes);
		}
		for (const path of ["/", "/api/v1/config", `${base}/tracked/opens`, `${base}/tracked`]) {
			assert.equal((await f.fetch("/__protected" + path)).status, 403);
		}
		assert.equal((await f.fetch(pixel, { method: "POST" })).status, 403);
	} finally { await f.close(); }
});

test("HEADs and automation do not count; concurrent reloads deduplicate and distinct clients update aggregate times", async () => {
	const f = await fixture();
	try {
		const headers = { "user-agent": "Thunderbird/140.0", "cf-connecting-ip": "192.0.2.1" };
		const head = await f.fetch(pixel, { method: "HEAD", headers }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
		for (const extra of [{ "user-agent": "Mozilla/5.0" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "user-agent": "Proofpoint" }]) await f.fetch(pixel, { headers: { ...headers, ...extra } });
		assert.equal((await f.json(`${base}/tracked/opens`)).openCount, 0);
		await Promise.all(Array.from({ length: 12 }, () => f.fetch(pixel, { headers })));
		const first = await f.json(`${base}/tracked/opens`);
		assert.equal(first.openCount, 1); assert(first.firstOpenedAt); assert.equal(first.lastOpenedAt, first.firstOpenedAt);
		await f.fetch(pixel, { headers: { ...headers, "user-agent": "Outlook/16.0" } });
		await f.fetch(pixel, { headers });
		const second = await f.json(`${base}/tracked/opens`);
		assert.equal(second.openCount, 2); assert.equal(second.firstOpenedAt, first.firstOpenedAt);
		assert(Date.parse(second.lastOpenedAt) >= Date.parse(first.lastOpenedAt));
		assert.deepEqual(Object.keys(second).sort(), ["enabled", "firstOpenedAt", "lastOpenedAt", "openCount"]);
		assert.equal((await f.fetch(`${base}/tracked`, { method: "DELETE" })).status, 204);
		assert.equal(await f.json("/__trackingRows"), 0);
		assert.equal((await f.fetch(pixel, { headers })).status, 200);
		assert.equal((await f.fetch(`${base}/tracked/opens`)).status, 404);
	} finally { await f.close(); }
});

test("lists expose open status for the latest sent message even when Inbox represents an incoming message", async () => {
	const f = await fixture();
	try {
		const sent = await f.json("/api/v1/emails?folder=sent");
		assert.deepEqual(sent.emails[0].open_tracking, {
			emailId: "tracked", enabled: true, openCount: 0, firstOpenedAt: null, lastOpenedAt: null,
		});
		await f.fetch(pixel, { headers: { "user-agent": "Thunderbird/140.0", "cf-connecting-ip": "192.0.2.1" } });
		const opened = (await f.json(`${base}?folder=sent&threaded=true`)).emails[0].open_tracking;
		assert.equal(opened.openCount, 1);
		assert.ok(opened.firstOpenedAt);
		assert.equal((await f.json(`${base}/tracked`)).open_tracking.openCount, 1);
		assert.equal((await f.json("/api/v1/mailboxes/team@example.com/threads/tracked"))[0].open_tracking.openCount, 1);
		const replyResponse = await f.send("/original/reply");
		assert.equal(replyResponse.status, 200);
		const reply = await replyResponse.json();
		const inbox = await f.json("/api/v1/emails?folder=inbox");
		assert.equal(inbox.emails[0].id, "original", "Keep the latest Inbox representative");
		assert.equal(inbox.emails[0].open_tracking.emailId, reply.id);
		assert.equal(inbox.emails[0].open_tracking.enabled, true);
		assert.equal(inbox.emails[0].open_tracking.openCount, 0);
		const untrackedResponse = await f.send("/original/reply", { ...payload, trackOpens: false });
		assert.equal(untrackedResponse.status, 200);
		const untracked = await untrackedResponse.json();
		assert.equal((await f.fetch("/__date", { method: "POST", body: JSON.stringify({ id: untracked.id, date: new Date(Date.now() + 60_000).toISOString() }) })).status, 204);
		const latest = (await f.json("/api/v1/emails?folder=inbox")).emails[0].open_tracking;
		assert.equal(latest.emailId, untracked.id, "An untracked latest reply must not inherit an older reply's status");
		assert.equal(latest.enabled, false);
		assert(!JSON.stringify(inbox).includes('"token"'));
	} finally { await f.close(); }
});

test("failed or unconfigured tracking sends create no tracking rows and drafts keep the explicit choice", async () => {
	const f = await fixture();
	try {
		for (const suffix of ["", "/original/reply", "/original/forward"]) {
			assert.equal((await f.send(suffix, { ...payload, attachments: [{ content: "dGVzdA==", filename: "test.txt", type: "text/plain", disposition: "attachment" }] }, { "x-test-fail": "true" })).status, 400);
		}
		assert.equal(await f.json("/__trackingRows"), 1);
		assert.equal(await f.json("/__attachmentCount"), 0);
		const draftResponse = await f.fetch("/api/v1/mailboxes/team@example.com/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Draft", trackOpens: true }) });
		assert.equal(draftResponse.status, 201);
		const draft = await draftResponse.json();
		assert.equal((await f.json(`${base}/${draft.id}`)).track_opens, true);
		assert.equal((await f.json(`${base}/${draft.id}/opens`)).enabled, false);
		assert.equal(await f.json("/__trackingRows"), 1);
	} finally { await f.close(); }
	const unconfigured = await fixture("");
	try {
		assert.equal((await unconfigured.json("/api/v1/config")).openTrackingAvailable, false);
		assert.equal((await unconfigured.send()).status, 400);
		assert.deepEqual(await unconfigured.json("/__calls"), []);
	} finally { await unconfigured.close(); }
});
