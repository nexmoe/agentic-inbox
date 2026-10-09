import { app } from "../../workers/index";
export { MailboxDO } from "../../workers/durableObject";

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		if (new URL(request.url).pathname === "/__seed") {
			const mailboxes = await request.json() as Record<string, any[]>;
			for (const [mailboxId, emails] of Object.entries(mailboxes)) {
				await env.BUCKET.put(`mailboxes/${mailboxId}.json`, "{}");
				const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
				await stub.getFolders();
				for (const email of emails) {
					await stub.createEmail(email.folder ?? "inbox", {
						sender: "sender@example.net", recipient: mailboxId, body: "Test body", ...email,
					}, []);
				}
			}
			return new Response(null, { status: 204 });
		}
		return app.fetch(request, env, ctx);
	},
};
