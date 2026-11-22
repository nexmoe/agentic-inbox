import { Hono } from "hono";
import { OPEN_TOKEN_PATTERN, openFingerprint } from "../lib/open-tracking";
import type { Env } from "../types";

// One transparent pixel; invalid and expired capabilities receive the same response.
const PIXEL = Uint8Array.of(71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59);
export const openTrackingApp = new Hono<{ Bindings: Env }>();

openTrackingApp.on(["GET", "HEAD"], "/pixel/:mailboxId/:file", async (c) => {
	if (c.req.method === "GET") {
		try {
			const file = c.req.param("file");
			const token = file.endsWith(".gif") ? file.slice(0, -4) : "";
			const mailboxId = c.req.param("mailboxId").toLowerCase();
			const addresses = c.env.EMAIL_ADDRESSES ?? [];
			const valid = OPEN_TOKEN_PATTERN.test(token) && mailboxId.length <= 254
				&& /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/.test(mailboxId);
			// Only existing/configured mailbox names may instantiate a Durable Object.
			const allowed = valid && (addresses.length > 0
				? addresses.some((address) => address.toLowerCase() === mailboxId)
				: !!await c.env.BUCKET.head(`mailboxes/${mailboxId}.json`));
			if (allowed) {
				const userAgent = (c.req.header("user-agent") ?? "").slice(0, 512);
				const asn = c.req.raw.cf?.asn;
				const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailboxId));
				await stub.recordEmailOpen(token, {
					userAgent,
					asn: typeof asn === "number" ? asn : undefined,
					purpose: `${c.req.header("purpose") ?? ""} ${c.req.header("sec-purpose") ?? ""}`.slice(0, 128),
					fingerprint: await openFingerprint(token, c.req.header("cf-connecting-ip") ?? "", userAgent),
				});
			}
		} catch {
			console.error("Could not record an email open");
		}
	}
	return new Response(c.req.method === "HEAD" ? null : PIXEL, { headers: {
		"Content-Type": "image/gif",
		"Content-Length": String(PIXEL.length),
		"Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
		Pragma: "no-cache",
		Expires: "0",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	} });
});
