import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { automatedOpen, openFingerprint, prepareOpenTracking, trackingOrigin } from "../workers/lib/open-tracking.ts";

test("user can opt out of tracking and gets a signature only with a valid origin", () => {
	assert.deepEqual(prepareOpenTracking(undefined, "team@example.com", false, "<p>Body</p>"), { html: "<p>Body</p>" });
	assert.deepEqual(prepareOpenTracking(undefined, "team@example.com", undefined, "<p>Body</p>"), { html: "<p>Body</p>" });
	for (const origin of [undefined, "javascript:alert(1)", "https://user:secret@example.com", "https://example.com/path", "https://example.com/?token=secret", "http://example.com"]) {
		assert.equal(trackingOrigin(origin), null);
		assert.throws(() => prepareOpenTracking(origin, "team@example.com", true, "<p>Body</p>"), error => error.status === 400);
	}
	assert.equal(trackingOrigin("http://localhost:3000"), "http://localhost:3000");
	const body = '<html><body><p>Body</p></body></html>';
	const tracked = prepareOpenTracking("https://mail.102417.xyz", "TEAM@example.com", true, body);
	assert.match(tracked.token, /^[\w-]{43}$/);
	assert(tracked.html.startsWith("<html><body><p>Body</p>"));
	assert(tracked.html.endsWith("</body></html>"));
	assert(tracked.html.includes(`https://mail.102417.xyz/mail-signatures/team%40example.com/${tracked.token}.png`));
	assert.notEqual(prepareOpenTracking("https://mail.102417.xyz", "team@example.com", true, body).token, tracked.token);
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
const signature = `/mail-signatures/team%40example.com/${"A".repeat(43)}.png`;
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

test("user sends, replies and forwards with a visible sender-domain signature and a unique image URL", async () => {
	// Given a mailbox with open tracking enabled on the public mail domain.
	const f = await fixture("https://mail.102417.xyz");
	try {
		assert.equal((await f.json("/api/v1/config")).openTrackingAvailable, true);
		// When the sender sends a new message, a reply and a forward.
		for (const suffix of ["", "/original/reply", "/original/forward"]) {
			const sent = await f.send(suffix); assert.equal(sent.status, 200);
			const { id } = await sent.json();
			const detail = await f.json(`${base}/${id}`);
			assert.equal(detail.track_opens, true);
			assert.equal(detail.body, payload.html);
			assert.deepEqual(await f.json(`${base}/${id}/opens`), { enabled: true, openCount: 0, firstOpenedAt: null, lastOpenedAt: null });
			assert(!JSON.stringify(detail).includes("tracking_token"));
		}
		// Then each delivered HTML body has a visible signature with a different image URL.
		const messages = await f.json("/__calls");
		const logos = messages.map(message => message.html.match(/https:\/\/mail\.102417\.xyz\/mail-signatures\/team%40example\.com\/([\w-]{43})\.png/)?.[0]);
		assert(logos.every(Boolean));
		assert.equal(new Set(logos).size, 3);
		for (const message of messages) {
			assert.equal((message.html.match(/<img /g) ?? []).length, 1);
			assert.equal(message.text, payload.text);
			assert.match(message.html, /<img [^>]*width="32"[^>]*height="32"/);
			assert.match(message.html, />example\.com<\/span>/);
			assert.doesNotMatch(message.html, /opacity\s*:\s*0|display\s*:\s*none/);
		}
		assert.equal((await f.send("", { ...payload, trackOpens: false })).status, 200);
		assert.equal((await f.json("/__calls")).at(-1).html, payload.html);
	} finally { await f.close(); }
});

test("user loads the signature and legacy pixel without signing in while mailbox APIs stay protected", async () => {
	// Given a delivered signature and a previously delivered pixel.
	const f = await fixture();
	try {
		// When the recipient requests the images and attempts to access the mailbox.
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
		// Then anonymous image loads succeed and all mailbox requests still require authentication.
		const logo = await f.fetch(signature);
		assert.equal(logo.status, 200);
		assert.equal(logo.headers.get("content-type"), "image/png");
		assert.match(logo.headers.get("cache-control"), /no-store/);
		const png = Buffer.from(await logo.arrayBuffer());
		assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
		assert.equal(png.readUInt32BE(16), 64);
		assert.equal(png.readUInt32BE(20), 64);
		const branded = await f.fetch(signature.replace("example.com", "lmspeed.net"));
		assert.equal(branded.status, 200);
		assert.notDeepEqual(Buffer.from(await branded.arrayBuffer()), png);
		for (const path of ["/", "/api/v1/config", `${base}/tracked/opens`, `${base}/tracked`]) {
			assert.equal((await f.fetch("/__protected" + path)).status, 403);
		}
		assert.equal((await f.fetch(pixel, { method: "POST" })).status, 403);
		assert.equal((await f.fetch(signature, { method: "POST" })).status, 403);
	} finally { await f.close(); }
});

test("HEADs and automation do not count; concurrent reloads deduplicate and distinct clients update aggregate times", async () => {
	const f = await fixture();
	try {
		const headers = { "user-agent": "Thunderbird/140.0", "cf-connecting-ip": "192.0.2.1" };
		const head = await f.fetch(signature, { method: "HEAD", headers }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
		for (const extra of [{ "user-agent": "Mozilla/5.0" }, { purpose: "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { "user-agent": "Proofpoint" }]) await f.fetch(pixel, { headers: { ...headers, ...extra } });
		assert.equal((await f.json(`${base}/tracked/opens`)).openCount, 0);
		await Promise.all(Array.from({ length: 12 }, () => f.fetch(signature, { headers })));
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

test("user reopens old and new drafts with tracking on by default and can save an explicit opt-out", async () => {
	// Given a draft saved before tracking had an on-by-default setting.
	const f = await fixture();
	const saveDraft = async (body) => {
		const response = await f.fetch("/api/v1/mailboxes/team@example.com/drafts", {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Draft", ...body }),
		});
		assert.equal(response.status, 201);
		return response.json();
	};
	try {
		// When the user reopens the old draft and saves new drafts with and without opting out.
		assert.equal((await f.fetch("/__upgradeDraft", { method: "POST" })).status, 204);
		const defaultDraft = await saveDraft({});
		const optedOut = await saveDraft({ trackOpens: false });
		const edited = await saveDraft({ draft_id: optedOut.id });
		const sent = await f.send("", { ...payload, trackOpens: undefined });
		assert.equal(sent.status, 200);

		// Then unset choices enable tracking, an explicit opt-out survives edits, and sending follows the default.
		assert.equal((await f.json(`${base}/legacy-draft`)).track_opens, true);
		assert.equal((await f.json(`${base}/${defaultDraft.id}`)).track_opens, true);
		assert.equal((await f.json(`${base}/${edited.id}`)).track_opens, false);
		assert.equal((await f.json(`${base}/${(await sent.json()).id}/opens`)).enabled, true);
	} finally { await f.close(); }
});

test("template mode integrates logo tracking when enabled and switches to static signature when disabled", async () => {
	const f = await fixture("https://mail.102417.xyz");
	try {
		const trackedSend = await f.send("", {
			from: { email: "team@example.com", name: "Nexmoe" },
			to: "recipient@example.net",
			subject: "Template tracked",
			html: "<p>Hello template</p>",
			text: "Hello template",
			trackOpens: true,
			template: true,
		});
		assert.equal(trackedSend.status, 200);
		const trackedId = (await trackedSend.json()).id;

		const untrackedSend = await f.send("", {
			from: { email: "team@example.com", name: "Nexmoe" },
			to: "recipient@example.net",
			subject: "Template untracked",
			html: "<p>Hello template</p>",
			text: "Hello template",
			trackOpens: false,
			template: true,
		});
		assert.equal(untrackedSend.status, 200);

		const messages = await f.json("/__calls");
		const trackedHtml = messages[0].html;
		const untrackedHtml = messages[1].html;
		assert.match(trackedHtml, /data-email-template="default"/);
		assert.match(trackedHtml, /data-track-state="tracked"/);
		assert.match(trackedHtml, /https:\/\/mail\.102417\.xyz\/mail-signatures\/team%40example\.com\/[\w-]{43}\.png/);
		assert.match(untrackedHtml, /data-email-template="default"/);
		assert.match(untrackedHtml, /data-track-state="untracked"/);
		assert.doesNotMatch(untrackedHtml, /<img\b/i);

		// Preview endpoint serves the domain PNG without recording an open event.
		const preview = await f.fetch("/mail-signatures/preview/nexmoe.com.png");
		assert.equal(preview.status, 200);
		assert.equal(preview.headers.get("content-type"), "image/png");
		assert.equal((await f.json(`${base}/${trackedId}/opens`)).openCount, 0);
	} finally { await f.close(); }
});
