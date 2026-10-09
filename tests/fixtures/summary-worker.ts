import { EmailAgent as RealEmailAgent } from "../../workers/agent";
import { app, receiveEmail } from "../../workers/index";
export { MailboxDO } from "../../workers/durableObject";

export class SummaryAgent extends RealEmailAgent {
	constructor(ctx: DurableObjectState, env: any) {
		super(ctx, { ...env, AI: {
			async run(model: string, inputs: any, options: any) {
				if (model !== "@cf/zai-org/glm-4.7-flash" || inputs.chat_template_kwargs?.enable_thinking !== false || !options?.signal) throw new Error("Invalid summary model configuration");
				if (inputs.response_format?.json_schema?.name !== "email_summary" || !inputs.response_format.json_schema.strict) throw new Error("Invalid GLM output schema");
				const previous = await env.BUCKET.get("qa-ai-count");
				await env.BUCKET.put("qa-ai-count", String(Number(previous ? await previous.text() : 0) + 1));
				await env.BUCKET.put("qa-summary-input", JSON.stringify(inputs));
				return { response: JSON.stringify({ title: "验证登录邮箱", points: ["验证码在 **10 分钟**后过期。"], codes: [{ label: "登录验证码", value: "000042" }], links: [{ label: "验证邮箱", sourceId: "link-1", kind: "action" }] }) };
			},
		} });
	}
	// Isolate automatic summaries from the separate reply-drafting feature.
	async handleNewEmail() {}
}

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		if (new URL(request.url).pathname === "/__receive") {
			const bytes = await request.arrayBuffer();
			await receiveEmail({ raw: new Response(bytes).body!, rawSize: bytes.byteLength, to: "team@example.com" }, env, ctx);
			return new Response(null, { status: 204 });
		}
		return app.fetch(request, env, ctx);
	},
};
