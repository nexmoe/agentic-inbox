import assert from "node:assert/strict";
import test from "node:test";
import { EmailSummaryService, emailSummaryText, MAX_SUMMARY_INPUT_CHARS } from "../workers/lib/email-summary.ts";

const message = (id, overrides = {}) => ({
	id, thread_id: "conversation", folder_id: "inbox", subject: "Project update",
	sender: "sender@example.com", recipient: "inbox@example.com", date: "2026-10-08T10:00:00Z",
	read: false, starred: false, body: "Please review the proposal.", ...overrides,
});

function fixture(messages = [message("first")], options = {}) {
	const state = { messages };
	const cache = new Map();
	const calls = [];
	const titles = [];
	const createService = (model = "test-model") => new EmailSummaryService({
		model,
		draftFolder: "drafts",
		getEmail: async (id) => state.messages.find((email) => email.id === id) ?? null,
		getThread: async (id) => state.messages.filter((email) => email.thread_id === id),
		getCached: async (key) => { options.onCacheRead?.(); return cache.get(key); },
		putCached: async (key, value) => { cache.set(key, value); },
		saveTitle: async (emailIds, title) => { await options.onSaveTitle?.(); titles.push({ emailIds, title }); },
		generate: async (prompt) => { calls.push(JSON.parse(prompt)); return options.generate ? options.generate(prompt) : { title: "周五前审核方案", text: "请在周五前审核方案。" }; },
	});
	return { state, cache, calls, titles, createService, service: createService() };
}

test("summarizes full chronological bodies and attachment metadata, excluding unsent drafts", async () => {
	const longBody = "More context. ".repeat(200) + "FINAL DEADLINE: October 12.";
	const f = fixture([
		message("reply", { date: "2026-10-09T10:00:00Z", body: longBody, attachments: [{ id: "a", filename: "proposal.pdf", mimetype: "application/pdf", size: 1200 }] }),
		message("first", { body: "Original decision: budget is $500." }),
		message("draft", { folder_id: "drafts", body: "UNSENT PRIVATE DRAFT" }),
	]);
	const result = await f.service.summarize("reply");
	assert.equal(result.messageCount, 2);
	assert.equal(result.title, "周五前审核方案");
	assert.deepEqual(f.titles, [{ emailIds: ["first", "reply"], title: result.title }]);
	assert.equal(f.state.messages[0].subject, "Project update");
	assert.deepEqual(f.calls[0].messages.map((email) => email.id), ["first", "reply"]);
	assert.match(f.calls[0].messages[1].body, /FINAL DEADLINE: October 12\.$/);
	assert.equal(f.calls[0].messages[1].attachments[0].filename, "proposal.pdf");
	assert.doesNotMatch(JSON.stringify(f.calls[0]), /UNSENT PRIVATE DRAFT/);
});

test("reuses a persisted summary across selected messages and Agent restarts", async () => {
	const f = fixture([message("first"), message("reply", { date: "2026-10-09T10:00:00Z" })]);
	const first = await f.service.summarize("first");
	const reopened = await f.createService().summarize("reply");
	assert.deepEqual(reopened, first);
	assert.equal(f.calls.length, 1);
	assert.equal(f.titles.length, 1);
});

test("pre-title cached summaries remain readable and upgrade only on explicit generation", async () => {
	const f = fixture();
	const legacy = { text: "旧版摘要", generatedAt: "2026-10-08T12:00:00Z", messageCount: 1 };
	// Persisted key and fingerprint from the previous release for this fixture.
	f.cache.set("email-summary:8b34dbc2c05eb4d7e25d48efeace82456b16cee760bcae80c157f52a3c2e787b", {
		fingerprint: "dba8516d2b06253ffb7d5aca3b2ac7dd9ae0c3806b3bce8411392498062c9d20", result: legacy,
	});
	assert.deepEqual(await f.service.getSaved("first"), legacy);
	assert.equal(f.calls.length, 0);
	assert.equal(f.titles.length, 0);
	assert.equal((await f.service.summarize("first")).title, "周五前审核方案");
	assert.equal(f.calls.length, 1);
	assert.equal(f.cache.size, 1);
});

test("opening details only reads summaries saved by background work and never triggers AI", async () => {
	const f = fixture();
	assert.equal(await f.service.getSaved("first"), undefined);
	assert.equal(f.calls.length, 0);
	const summary = await f.service.summarize("first");
	assert.deepEqual(await f.createService().getSaved("first"), summary);
	assert.equal(f.calls.length, 1);
	f.state.messages.push(message("reply", { date: "2026-10-10T10:00:00Z" }));
	assert.equal(await f.service.getSaved("first"), undefined);
	assert.equal(f.calls.length, 1);
});

test("marking read, starring, or moving an email does not spend another model call", async () => {
	const f = fixture();
	await f.service.summarize("first");
	Object.assign(f.state.messages[0], { read: true, starred: true, folder_id: "archive" });
	await f.service.summarize("first");
	assert.equal(f.calls.length, 1);
});

test("a new reply invalidates the old summary without accumulating old cache entries", async () => {
	const f = fixture();
	await f.service.summarize("first");
	f.state.messages.push(message("reply", { date: "2026-10-09T10:00:00Z", body: "The deadline has changed to October 15." }));
	const result = await f.service.summarize("first");
	assert.equal(result.messageCount, 2);
	assert.equal(f.calls.length, 2);
	assert.equal(f.cache.size, 1);
	assert.match(f.calls[1].messages[1].body, /October 15/);
});

test("changes to the body or model invalidate the cached summary", async () => {
	const f = fixture();
	await f.service.summarize("first");
	f.state.messages[0].body = "Corrected amount: $750.";
	await f.service.summarize("first");
	await f.createService("another-model").summarize("first");
	assert.equal(f.calls.length, 3);
});

test("concurrent opens share the same in-flight model call", async () => {
	let release, started, secondRead;
	const gate = new Promise((resolve) => { release = resolve; });
	const began = new Promise((resolve) => { started = resolve; });
	const readTwice = new Promise((resolve) => { secondRead = resolve; });
	let reads = 0;
	const f = fixture(undefined, {
		onCacheRead: () => { if (++reads === 2) secondRead(); },
		generate: async () => { started(); await gate; return { title: "共享摘要", text: "Shared summary" }; },
	});
	const first = f.service.summarize("first");
	await began;
	const second = f.service.summarize("first");
	await readTwice;
	release();
	const [a, b] = await Promise.all([first, second]);
	assert.deepEqual(a, b);
	assert.equal(f.calls.length, 1);
});

test("a failed generation is not cached and can be retried manually", async () => {
	let attempt = 0;
	const f = fixture(undefined, { generate: async () => { if (++attempt === 1) throw new Error("quota unavailable"); return { title: "恢复摘要", text: "Recovered summary" }; } });
	await assert.rejects(f.service.summarize("first"), /quota unavailable/);
	assert.equal(f.cache.size, 0);
	assert.equal((await f.service.summarize("first")).text, "Recovered summary");
	assert.equal(f.calls.length, 2);
});

test("an empty model response is treated as a retryable failure", async () => {
	const f = fixture(undefined, { generate: async () => "  " });
	await assert.rejects(f.service.summarize("first"), (error) => error.status === 502);
	assert.equal(f.cache.size, 0);
});

test("invalid, empty, overlong, or multiline titles cannot replace the list subject", async () => {
	for (const output of [null, "plain text", {}, { title: "   ", text: "Summary" }, { title: "字".repeat(33), text: "Summary" }, { title: "第一行\n第二行", text: "Summary" }, { title: "标题", text: " " }, { title: 12, text: "Summary" }]) {
		const f = fixture(undefined, { generate: async () => output });
		await assert.rejects(f.service.summarize("first"), (error) => error.status === 502);
		assert.equal(f.cache.size, 0);
		assert.equal(f.titles.length, 0);
	}
});

test("a title write failure does not mark the summary as ready and can be retried", async () => {
	let writes = 0;
	const f = fixture(undefined, { onSaveTitle: async () => { if (++writes === 1) throw new Error("storage unavailable"); } });
	await assert.rejects(f.service.summarize("first"), /storage unavailable/);
	assert.equal(await f.service.getSaved("first"), undefined);
	assert.equal((await f.service.summarize("first")).title, "周五前审核方案");
	assert.equal(f.titles.length, 1);
});

test("a reply arriving during generation cannot publish an outdated conversation title", async () => {
	const f = fixture(undefined, { generate: async () => {
		f.state.messages.push(message("reply", { date: "2026-10-10T10:00:00Z" }));
		return { title: "过期标题", text: "Outdated summary" };
	} });
	await assert.rejects(f.service.summarize("first"), (error) => error.status === 429);
	assert.equal(f.cache.size, 0);
	assert.equal(f.titles.length, 0);
});

test("missing emails and drafts never trigger AI", async () => {
	const f = fixture([message("draft", { folder_id: "drafts" })]);
	await assert.rejects(f.service.summarize("missing"), (error) => error.status === 404);
	await assert.rejects(f.service.summarize("draft"), (error) => error.status === 400);
	assert.equal(f.calls.length, 0);
});

test("nullable email metadata can still be summarized", async () => {
	const f = fixture([message("first", { subject: null, sender: null, recipient: null, date: null, body: null })]);
	await f.service.summarize("first");
	assert.equal(f.calls[0].messages[0].subject, "");
	assert.equal(f.calls[0].messages[0].body, "");
});

test("oversized conversations fail explicitly instead of silently dropping the end", async () => {
	const f = fixture([message("first", { body: "x".repeat(MAX_SUMMARY_INPUT_CHARS) })]);
	await assert.rejects(f.service.summarize("first"), (error) => error.status === 413);
	assert.equal(f.calls.length, 0);
});

test("each mailbox permits at most two simultaneous generations", async () => {
	let release, started;
	const gate = new Promise((resolve) => { release = resolve; });
	const bothStarted = new Promise((resolve) => { started = resolve; });
	let starts = 0;
	const f = fixture([message("a", { thread_id: "a" }), message("b", { thread_id: "b" }), message("c", { thread_id: "c" })], {
		generate: async () => { if (++starts === 2) started(); await gate; return { title: "摘要标题", text: "Summary" }; },
	});
	const first = f.service.summarize("a");
	const second = f.service.summarize("b");
	await bothStarted;
	await assert.rejects(f.service.summarize("c"), (error) => error.status === 429);
	release();
	await Promise.all([first, second]);
	assert.equal(f.calls.length, 2);
});

test("HTML conversion preserves links, entities, paragraphs, and plain-text comparisons", () => {
	const text = emailSummaryText('<style>hidden style</style><script>hidden script</script><p>R&amp;D &#x4e2d;&#25991;</p><p><a href="https://example.com/?a=1&amp;b=2">Review</a></p>Budget < $50 and > $10.');
	assert.match(text, /R&D 中文\n/);
	assert.match(text, /Review \(https:\/\/example.com\/\?a=1&b=2\)/);
	assert.match(text, /Budget < \$50 and > \$10/);
	assert.doesNotMatch(text, /hidden|<script>|<style>/);
});
