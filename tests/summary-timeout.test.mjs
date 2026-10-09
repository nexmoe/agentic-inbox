import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import api from "../app/services/api.ts";

test("a gateway summary that takes 35 seconds is saved and cached", { timeout: 65_000 }, async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/summary-worker.ts"], bundle: true, write: false,
		format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
		banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	});
	let calls = 0;
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true }, EMAIL_AGENT: { className: "SummaryAgent", useSQLite: true } },
		r2Buckets: ["BUCKET"],
		bindings: { EMAIL_ADDRESSES: ["team@example.com"], EMAIL_FORWARDING: {}, AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://gateway.example/openai/v1", AI_MODEL: "Z-AI/GLM-5.3-Flash", AI_API_KEY: "synthetic-test-key" },
		outboundService: async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 35_000));
			return Response.json({ id: "synthetic", created: 1, model: "Z-AI/GLM-5.3-Flash", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ title: "审核仍在进行", points: ["提交的链接仍在审核中。"], codes: [], links: [] }) } }] });
		},
	});
	try {
		await (await runtime.getR2Bucket("BUCKET")).put("mailboxes/team@example.com.json", "{}");
		const raw = ["From: hello@example.net", "To: team@example.com", "Subject: Link review", "Message-ID: <slow-summary@example.net>", "", "Your submitted link is still under review."].join("\r\n");
		assert.equal((await runtime.dispatchFetch("https://test/__receive", { method: "POST", body: raw })).status, 204);
		const list = await (await runtime.dispatchFetch("https://test/api/v1/emails?folder=inbox")).json();
		const emailId = list.emails[0].id;
		const url = `https://test/api/v1/mailboxes/team@example.com/emails/${emailId}/summary`;
		for (let attempt = 0; calls === 0 && attempt < 50; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(calls, 1);
		const seedPending = (ageMs) => runtime.dispatchFetch("https://test/__summary-state", {
			method: "POST", body: JSON.stringify({ emailId, state: { status: "pending", queuedAt: new Date(Date.now() - ageMs).toISOString() } }),
		});
		await seedPending(150_000);
		assert.equal((await (await runtime.dispatchFetch(url)).json()).status, "pending", "The second gateway attempt must not be reported as stale");
		await seedPending(220_000);
		assert.equal((await (await runtime.dispatchFetch(url)).json()).status, "error", "Abandoned jobs still time out");
		await seedPending(0);
		const response = await runtime.dispatchFetch(url, { method: "POST" });
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.title, "审核仍在进行");
		const saved = await (await runtime.dispatchFetch(url)).json();
		assert.equal(saved.status, "ready");
		assert.equal(saved.summary.title, result.title);
		assert.equal((await (await runtime.dispatchFetch("https://test/api/v1/emails?folder=inbox")).json()).emails[0].ai_title, result.title);
		assert.equal(calls, 1, "Receipt and manual retry share one in-flight generation");
	} finally { await runtime.dispose(); }
});

test("the summary client waits for slow generation while ordinary requests keep their deadline", async (t) => {
	// Compress wall time while exercising the actual AbortController/fetch path.
	const realSetTimeout = globalThis.setTimeout;
	t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => realSetTimeout(callback, delay / 1_000, ...args));
	let responseDelay = 40;
	t.mock.method(globalThis, "fetch", async (_url, init) => new Promise((resolve, reject) => {
		const timer = realSetTimeout(() => resolve(Response.json({ title: "Ready" })), responseDelay);
		init.signal.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal.reason); }, { once: true });
	}));
	assert.equal((await api.summarizeEmail("team@example.com", "synthetic-id")).title, "Ready");
	responseDelay = 150;
	await assert.rejects(api.summarizeEmail("team@example.com", "synthetic-id"), { name: "AbortError" });
	responseDelay = 40;
	await assert.rejects(api.getConfig(), { name: "AbortError" });
});
