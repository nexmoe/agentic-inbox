import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

test("receipt generates structured summaries before details are opened, then serves them without more AI calls", async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/summary-worker.ts"], bundle: true, write: false,
		format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
		banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	});
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true }, EMAIL_AGENT: { className: "SummaryAgent", useSQLite: true } },
		r2Buckets: ["BUCKET"],
		bindings: { EMAIL_ADDRESSES: ["team@example.com"], AI_MODEL: "@cf/zai-org/glm-4.7-flash", EMAIL_FORWARDING: {} },
	});
	const get = async (path) => {
		const response = await runtime.dispatchFetch(`https://test${path}`);
		assert.equal(response.status, 200);
		return response.json();
	};
	try {
		const bucket = await runtime.getR2Bucket("BUCKET");
		await bucket.put("mailboxes/team@example.com.json", "{}");
		const raw = ["From: Example <login@example.net>", "To: team@example.com", "Subject: Your login code", "Message-ID: <summary-test@example.net>", "Content-Type: text/html; charset=utf-8", "", '<p>Your code is <b>000042</b>. It expires in 10 minutes.</p><a href="https://example.net/verify?token=abc%2B123&amp;next=%2Finbox">Verify email</a><p>FULL_BODY_TAIL</p>'].join("\r\n");
		assert.equal((await runtime.dispatchFetch("https://test/__receive", { method: "POST", body: raw })).status, 204);
		let proof;
		for (let attempt = 0; attempt < 50; attempt++) {
			proof = await bucket.get("qa-summary-input");
			if (proof) break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert(proof, "Receipt starts AI work without any detail or summary request");
		const inputs = await proof.json();
		assert.equal(inputs.response_format.type, "json_schema");
		const userPrompt = inputs.messages.find((message) => message.role === "user").content;
		assert.match(userPrompt, /^请将以下完整邮件提炼为 1–3 个要点/);
		const prompt = JSON.parse(userPrompt.slice(userPrompt.indexOf("\n\n") + 2));
		assert.match(prompt.messages[0].body, /FULL_BODY_TAIL/);
		assert.equal(prompt.sourceLinks[0].url, "https://example.net/verify?token=abc%2B123&next=%2Finbox");
		const list = await get("/api/v1/emails?folder=inbox");
		const id = list.emails[0].id;
		let state;
		for (let attempt = 0; attempt < 30; attempt++) {
			state = await get(`/api/v1/mailboxes/team@example.com/emails/${id}/summary`);
			if (state.status === "ready") break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.equal(state.status, "ready");
		assert.deepEqual(state.summary.details, { points: ["验证码在 **10 分钟**后过期。"], codes: [{ label: "登录验证码", value: "000042" }], links: [{ label: "验证邮箱", url: "https://example.net/verify?token=abc%2B123&next=%2Finbox", kind: "action" }] });
		assert.equal((await get("/api/v1/emails?folder=inbox")).emails[0].ai_title, state.summary.title);
		const detail = await get(`/api/v1/mailboxes/team@example.com/emails/${id}`);
		assert.equal(detail.subject, "Your login code");
		assert.match(detail.body, /FULL_BODY_TAIL/);
		for (let open = 0; open < 3; open++) await get(`/api/v1/mailboxes/team@example.com/emails/${id}/summary`);
		assert.equal(await (await bucket.get("qa-ai-count")).text(), "1");
	} finally { await runtime.dispose(); }
});

for (const model of ["gateway-model", "Z-AI/GLM-5.3-Flash"]) test(`${model} receipt persists a structured summary without Workers AI and reopening only reads the cache`, async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/summary-worker.ts"], bundle: true, write: false,
		format: "esm", platform: "browser", target: "es2022", external: ["cloudflare:*", "node:*", "path"],
		banner: { js: 'import * as nodePath from "node:path"; const require = (name) => { if (name === "path") return nodePath; throw new Error(`Unexpected require: ${name}`); };' },
	});
	const calls = [];
	const runtime = new Miniflare({
		modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		durableObjects: { MAILBOX: { className: "MailboxDO", useSQLite: true }, EMAIL_AGENT: { className: "SummaryAgent", useSQLite: true } },
		r2Buckets: ["BUCKET"],
		bindings: { EMAIL_ADDRESSES: ["team@example.com"], EMAIL_FORWARDING: {}, AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://gateway.example/openai/v1", AI_MODEL: model, AI_API_KEY: "synthetic-test-key" },
		outboundService: async (request) => {
			assert.equal(request.url, "https://gateway.example/openai/v1/chat/completions");
			assert.equal(request.headers.get("Authorization"), "Bearer synthetic-test-key");
			const inputs = await request.json();
			assert.equal(inputs.model, model);
			if (model.startsWith("Z-AI/GLM-")) {
				assert.equal(inputs.response_format.type, "json_object");
				assert.match(inputs.messages.find((message) => message.role === "system").content, /JSON schema:/);
			} else assert.equal(inputs.response_format.json_schema.strict, true);
			assert.match(inputs.messages.find((message) => message.role === "user").content, /FULL_GATEWAY_BODY_TAIL/);
			calls.push(inputs);
			const content = JSON.stringify({ title: "验证登录邮箱", points: ["验证码有效期为 10 分钟。"], codes: [{ label: "验证码", value: "000042" }], links: [{ label: "验证邮箱", sourceId: "link-1", kind: "action" }] });
			return Response.json({ id: "synthetic", created: 1, model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: model.startsWith("Z-AI/GLM-") ? `\n\`\`\`json\n${content}\n\`\`\`\n` : content } }] });
		},
	});
	try {
		const bucket = await runtime.getR2Bucket("BUCKET");
		await bucket.put("mailboxes/team@example.com.json", "{}");
		const raw = ["From: login@example.net", "To: team@example.com", "Subject: Your login code", "Message-ID: <gateway-test@example.net>", "Content-Type: text/html; charset=utf-8", "", '<p>Your code is 000042. It expires in 10 minutes.</p><a href="https://example.net/verify">Verify email</a><p>FULL_GATEWAY_BODY_TAIL</p>'].join("\r\n");
		assert.equal((await runtime.dispatchFetch("https://test/__receive", { method: "POST", body: raw })).status, 204);
		const list = await (await runtime.dispatchFetch("https://test/api/v1/emails?folder=inbox")).json();
		const id = list.emails[0].id;
		const summaryUrl = `https://test/api/v1/mailboxes/team@example.com/emails/${id}/summary`;
		let state;
		for (let attempt = 0; attempt < 50; attempt++) {
			state = await (await runtime.dispatchFetch(summaryUrl)).json();
			if (state.status === "ready") break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert.equal(state.status, "ready");
		assert.equal(state.summary.title, "验证登录邮箱");
		assert.equal(state.summary.details.codes[0].value, "000042");
		assert.deepEqual(state.summary.details.links, [{ label: "验证邮箱", url: "https://example.net/verify", kind: "action" }]);
		for (let open = 0; open < 3; open++) assert.equal((await (await runtime.dispatchFetch(summaryUrl)).json()).status, "ready");
		assert.equal(calls.length, 1);
		assert.equal((await (await runtime.dispatchFetch("https://test/api/v1/emails?folder=inbox")).json()).emails[0].ai_title, state.summary.title);
	} finally { await runtime.dispose(); }
});
