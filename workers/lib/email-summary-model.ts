import { createWorkersAI } from "workers-ai-provider";
import type { LanguageModel } from "ai";

export function createEmailSummaryModel(ai: Ai, model: string, signal: AbortSignal): LanguageModel {
	// workers-ai-provider puts passthrough settings in run options and drops
	// the SDK abort signal. Model settings belong in inputs; cancellation in options.
	const binding = {
		run: (modelName: string, inputs: Record<string, unknown>, options?: AiOptions) => ai.run(
			modelName,
			{
				...inputs,
				...(modelName === "@cf/zai-org/glm-4.7-flash" ? { chat_template_kwargs: { enable_thinking: false } } : {}),
			},
			{ ...options, signal },
		),
	} as Ai;
	return createWorkersAI({ binding })(model);
}
