import production from "../../workers/app";
import { app } from "../../workers/index";
import { MailboxDO as BaseMailboxDO } from "../../workers/durableObject";

export class MailboxDO extends BaseMailboxDO {
	async setEmailDate(id: string, date: string) {
		this.ctx.storage.sql.exec("UPDATE emails SET date = ? WHERE id = ?", date, id);
	}

	async trackingRows() {
		return [...this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM email_tracking")][0].count;
	}
}

let calls: unknown[] = [];

export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext) {
		const url = new URL(request.url);
		const stub = env.MAILBOX.get(env.MAILBOX.idFromName("team@example.com"));
		if (url.pathname === "/__seed") {
			await env.BUCKET.put("mailboxes/team@example.com.json", "{}");
			await stub.getFolders();
			await stub.createEmail("inbox", {
				id: "original", subject: "Original", sender: "sender@example.net", recipient: "team@example.com",
				body: "Original body", date: "2026-01-01", message_id: "original@example.net", thread_id: "original",
			}, []);
			await stub.createEmail("sent", {
				id: "tracked", subject: "Tracked", sender: "team@example.com", recipient: "recipient@example.net",
				body: "Stored body has no pixel", date: new Date(Date.now() - 60_000).toISOString(),
				thread_id: "tracked", track_opens: true,
			}, [], "A".repeat(43));
			calls = [];
			return new Response(null, { status: 204 });
		}
		if (url.pathname === "/__calls") return Response.json(calls);
		if (url.pathname === "/__date") {
			const { id, date } = await request.json() as { id: string; date: string };
			await stub.setEmailDate(id, date);
			return new Response(null, { status: 204 });
		}
		if (url.pathname === "/__trackingRows") return Response.json(await stub.trackingRows());
		if (url.pathname === "/__attachmentCount") return Response.json((await env.BUCKET.list({ prefix: "attachments/" })).objects.length);
		const bindings = { ...env, POLICY_AUD: "test-policy", TEAM_DOMAIN: "https://access.example.com", EMAIL: {
			async send(message: unknown) {
				calls.push(message);
				if (request.headers.get("x-test-fail")) throw Object.assign(new Error("Synthetic delivery failure"), { code: "E_VALIDATION_ERROR" });
				return { messageId: "accepted@example.com" };
			},
		} };
		if (url.pathname.startsWith("/__protected/")) {
			url.pathname = url.pathname.slice("/__protected".length);
			return production.fetch(new Request(url, request), bindings, ctx);
		}
		return url.pathname.startsWith("/pixel/")
			? production.fetch(request, bindings, ctx)
			: app.fetch(request, bindings, ctx);
	},
};
