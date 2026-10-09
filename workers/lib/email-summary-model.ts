import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";

export function createEmailSummaryModel(ai: Ai, model: string, signal: AbortSignal): LanguageModel {
	// Adapt provider settings to the binding without losing cancellation.
	const binding = {
		run: (modelName: string, inputs: Record<string, unknown>, options?: AiOptions) => {
			const isGlm = modelName === "@cf/zai-org/glm-4.7-flash";
			const format = inputs.response_format as { type?: string; json_schema?: Record<string, unknown> } | undefined;
			// The provider emits the flat Workers AI schema; GLM expects OpenAI's named wrapper.
			const responseFormat = isGlm && format?.type === "json_schema" && format.json_schema && !format.json_schema.schema
				? { response_format: { ...format, json_schema: { name: "email_summary", schema: format.json_schema, strict: true } } }
				: {};
			return ai.run(modelName, {
				...inputs,
				...responseFormat,
				...(isGlm ? { chat_template_kwargs: { enable_thinking: false } } : {}),
			}, { ...options, signal });
		},
	} as Ai;
	return createWorkersAI({ binding })(model);
}
