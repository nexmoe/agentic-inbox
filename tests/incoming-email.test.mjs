import assert from "node:assert/strict";
import test from "node:test";
import { deliverIncomingEmail } from "../workers/lib/incoming-email.ts";

test("stores incoming mail when no forwarding destination is configured", async () => {
	let stored = false;
	await deliverIncomingEmail(async () => { stored = true; });
	assert.equal(stored, true);
});

test("stores mail and delivers the configured copy", async () => {
	const delivered = new Set();
	await deliverIncomingEmail(
		async () => { delivered.add("inbox"); },
		async () => { delivered.add("gmail"); },
	);
	assert.deepEqual(delivered, new Set(["inbox", "gmail"]));
});

test("still forwards when storage fails, then reports the failure", async () => {
	const failure = new Error("storage unavailable");
	let forwarded = false;
	await assert.rejects(deliverIncomingEmail(
		() => { throw failure; },
		async () => { forwarded = true; },
	), (error) => error === failure);
	assert.equal(forwarded, true);
});

test("waits for storage when forwarding fails, then reports the failure", async () => {
	const failure = new Error("forwarding unavailable");
	let finishStorage;
	let stored = false;
	const storage = new Promise((resolve) => { finishStorage = resolve; });
	const result = deliverIncomingEmail(
		async () => { await storage; stored = true; },
		async () => { throw failure; },
	);
	let settled = false;
	void result.catch(() => { settled = true; });
	await new Promise(setImmediate);
	assert.equal(settled, false);
	finishStorage();
	await assert.rejects(result, (error) => error === failure);
	assert.equal(stored, true);
});
