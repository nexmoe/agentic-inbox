import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createWorkersAI } from "workers-ai-provider";
import { extractJsonMiddleware, wrapLanguageModel } from "ai";
import type { LanguageModel } from "ai";
import { createEmailSummaryModel } from "./email-summary-model.ts";

export interface EmailAIEnvironment {
	AI: Ai;
	AI_MODEL: string;
	AI_PROVIDER?: string;
	AI_BASE_URL?: string;
	AI_API_KEY?: string;
	AI_PREVIOUS_MODELS?: string[];
}

type ModelPurpose = "chat" | "summary" | "injection" | "verification";

/** Reasoning gateways need more time than the small Workers AI models. */
export function emailAIRequestTimeoutMs(env: Pick<EmailAIEnvironment, "AI_PROVIDER">): number {
	return env.AI_PROVIDER === "openai-compatible" ? 90_000 : 25_000;
}

/** All email AI features use the selected provider, including safety checks. */
export function createEmailModel(env: EmailAIEnvironment, purpose: ModelPurpose = "chat", signal?: AbortSignal): LanguageModel {
	if (env.AI_PROVIDER === "openai-compatible") {
		let url: URL;
		try { url = new URL(env.AI_BASE_URL ?? ""); }
		catch { throw new Error("Configure a valid AI gateway base URL."); }
		if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
			throw new Error("The AI gateway base URL must use HTTPS without credentials, query parameters, or a fragment.");
		}
		if (!env.AI_API_KEY?.trim()) throw new Error("Configure the AI_API_KEY Worker secret.");
		if (!env.AI_MODEL?.trim()) throw new Error("Configure an AI gateway model.");
		const isGlm = /(?:^|\/)glm-/i.test(env.AI_MODEL);
		const isGlm53 = /(?:^|\/)glm-5\.3(?:-|$)/i.test(env.AI_MODEL);
		const provider = createOpenAICompatible({
			name: "mail-gateway",
			baseURL: url.href.replace(/\/+$/, ""),
			apiKey: env.AI_API_KEY.trim(),
			// Z.ai accepts JSON mode; Output.object still validates the result locally.
			supportsStructuredOutputs: !isGlm,
			// GLM-5.3 requires thinking. Use its lightest supported effort.
			transformRequestBody: (body) => isGlm53 ? { ...body, thinking: { type: "enabled" }, reasoning_effort: "low" } : body,
			// Workers supports manual redirects; do not forward credentials elsewhere.
			fetch: async (input, init) => {
				const started = Date.now();
				console.info("AI gateway request started", { purpose });
				try {
					const response = await fetch(input, { ...init, redirect: "manual" });
					console.info("AI gateway response received", { purpose, status: response.status, durationMs: Date.now() - started });
					if (response.status >= 300 && response.status < 400) throw new Error("The AI gateway returned an unexpected redirect.");
					return response;
				} catch (error) {
					console.warn("AI gateway request failed", { purpose, name: (error as Error).name, durationMs: Date.now() - started });
					throw error;
				}
			},
		});
		const model = provider.chatModel(env.AI_MODEL.trim());
		if (!isGlm || purpose !== "summary") return model;
		return wrapLanguageModel({
			model,
			middleware: [
				{
					specificationVersion: "v3",
					transformParams: async ({ params }) => {
						if (params.responseFormat?.type !== "json" || !params.responseFormat.schema) return params;
						// JSON mode guarantees JSON syntax, not our fields or constraints.
						// The compatible provider otherwise discards this schema entirely.
						const instruction = `Return only a JSON object matching this JSON schema. Include every required field; use empty arrays when no codes or links exist.\nJSON schema:\n${JSON.stringify(params.responseFormat.schema)}`;
						const systemIndex = params.prompt.findIndex((message) => message.role === "system");
						const prompt = params.prompt.map((message, index) => index === systemIndex && message.role === "system"
							? { ...message, content: `${message.content}\n\n${instruction}` } : message);
						if (systemIndex < 0) prompt.unshift({ role: "system", content: instruction });
						return { ...params, prompt, responseFormat: { type: "json" } };
					},
				},
				extractJsonMiddleware({
					// Only unwrap presentation fences. Output.object still validates JSON
					// and every field; no repair call or extra model request is made.
					transform: (text) => text.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim(),
				}),
			],
		});
	}
	if (env.AI_PROVIDER && env.AI_PROVIDER !== "workers-ai") throw new Error("Unknown AI provider.");
	if (purpose === "summary") return createEmailSummaryModel(env.AI, env.AI_MODEL, signal ?? AbortSignal.timeout(emailAIRequestTimeoutMs(env)));
	const model = purpose === "injection" ? "@cf/meta/llama-3.1-8b-instruct-fast"
		: purpose === "verification" ? "@cf/meta/llama-4-scout-17b-16e-instruct" : env.AI_MODEL;
	const binding = signal ? { run: (name: string, inputs: Record<string, unknown>, options?: AiOptions) => env.AI.run(name as Parameters<Ai["run"]>[0], inputs, { ...options, signal }) } as Ai : env.AI;
	return createWorkersAI({ binding })(model);
}
