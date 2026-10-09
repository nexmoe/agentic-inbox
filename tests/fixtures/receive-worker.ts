import { Agent } from "agents";
import { app, receiveEmail } from "../../workers/index";
export { MailboxDO } from "../../workers/durableObject";

export class ReceiptAgent extends Agent<any> {
	async onRequest(request: Request) {
		const payload = await request.json() as { emailId: string };
		await this.env.BUCKET.put(`receipt-events/${this.name}/${payload.emailId}.json`, JSON.stringify(payload));
		return new Response("OK");
	}
}

export default {
	async fetch(request: Request, env: any) {
		const url = new URL(request.url);
		if (url.pathname === "/__receive") {
			const bytes = await request.arrayBuffer();
			const tasks: Promise<unknown>[] = [];
			await receiveEmail({ raw: new Response(bytes).body!, rawSize: bytes.byteLength, to: url.searchParams.get("to")! }, env, {
				waitUntil: (task: Promise<unknown>) => { tasks.push(task); },
			} as ExecutionContext);
			await Promise.all(tasks);
			return new Response(null, { status: 204 });
		}
		return app.fetch(request, env);
	},
};
