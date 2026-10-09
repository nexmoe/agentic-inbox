import assert from "node:assert/strict";
import test from "node:test";
import { generateText, Output } from "ai";
import { createEmailSummaryModel } from "../workers/lib/email-summary-model.ts";
import { EmailSummaryOutputSchema } from "../workers/lib/email-summary.ts";

test("summary model sends GLM thinking control in inputs and cancellation in binding options", async () => {
	const signal = new AbortController().signal;
	const output = { title: "审核方案", text: "请在周五前审核方案。" };
	const binding = { run: async (model, inputs, options) => {
		assert.equal(model, "@cf/zai-org/glm-4.7-flash");
		assert.equal(inputs.chat_template_kwargs?.enable_thinking, false);
		assert.equal(options?.signal, signal);
		return { response: JSON.stringify(output) };
	} };
	const result = await generateText({ model: createEmailSummaryModel(binding, "@cf/zai-org/glm-4.7-flash", signal), prompt: "Synthetic email", output: Output.object({ schema: EmailSummaryOutputSchema }), maxRetries: 0, abortSignal: signal });
	assert.deepEqual(result.output, output);
});

test("summary model forwards cancellation without GLM-only settings on other models", async () => {
	const signal = new AbortController().signal;
	const binding = { run: async (_model, inputs, options) => {
		assert.equal(inputs.chat_template_kwargs, undefined);
		assert.equal(options?.signal, signal);
		return { response: "OK" };
	} };
	const result = await generateText({ model: createEmailSummaryModel(binding, "@cf/meta/llama-3.1-8b-instruct", signal), prompt: "Synthetic email", maxRetries: 0, abortSignal: signal });
	assert.equal(result.text, "OK");
});
