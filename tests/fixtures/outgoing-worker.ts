import { app } from "../../workers/index";
export { MailboxDO } from "../../workers/durableObject";

let calls: unknown[] = [];

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		const path = new URL(request.url).pathname;
		if (path === "/__seed") {
			await env.BUCKET.put("mailboxes/team@example.com.json", "{}");
			const stub = env.MAILBOX.get(env.MAILBOX.idFromName("team@example.com"));
			await stub.getFolders();
			await stub.createEmail("inbox", {
				id: "original", subject: "Synthetic message", sender: "sender@example.net",
				recipient: "team@example.com", body: "Synthetic original body", read: false,
				date: "2026-10-12", message_id: "original@example.net", thread_id: "original",
			}, []);
			await stub.createEmail("draft", {
				id: "draft", subject: "Synthetic draft", sender: "team@example.com",
				recipient: "recipient@example.net", body: "Synthetic draft body", date: "2026-10-12",
			}, []);
			calls = [];
			return new Response(null, { status: 204 });
		}
		if (path === "/__calls") return Response.json(calls);
		if (path === "/__attachments") return Response.json((await env.BUCKET.list({ prefix: "attachments/" })).objects.length);
		const mode = request.headers.get("x-test-delivery");
		return app.fetch(request, {
			...env,
			EMAIL: {
				async send(message: unknown) {
					calls.push(message);
					if (mode === "pending") await env.DELIVERY.fetch("https://provider.test");
					if (mode === "failure") throw Object.assign(new Error("Private upstream diagnostic"), {
						code: request.headers.get("x-test-code") || "E_SENDER_NOT_VERIFIED",
					});
					return { messageId: "accepted@example.com" };
				},
			},
		}, ctx);
	},
};
