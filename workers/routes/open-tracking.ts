import { Hono, type Context } from "hono";
import { OPEN_TOKEN_PATTERN, openFingerprint } from "../lib/open-tracking";
import signatureLogos from "../lib/signature-logos.json";
import type { Env } from "../types";

// Previously delivered emails still refer to this transparent GIF.
const PIXEL = Uint8Array.of(71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59);
const logos = new Map(Object.entries(signatureLogos));
export const openTrackingApp = new Hono<{ Bindings: Env }>();

async function recordImageLoad(c: Context<{ Bindings: Env }>, mailboxId: string, file: string, extension: string) {
	if (c.req.method !== "GET" || !file.endsWith(extension)) return;
	try {
		const token = file.slice(0, -extension.length);
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
		console.error("Could not record an email image load");
	}
}

function imageResponse(method: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) {
	return new Response(method === "HEAD" ? null : bytes, { headers: {
		"Content-Type": contentType,
		"Content-Length": String(bytes.length),
		"Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
		Pragma: "no-cache",
		Expires: "0",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	} });
}

openTrackingApp.on(["GET", "HEAD"], "/mail-signatures/:mailboxId/:file", async (c) => {
	const mailboxId = c.req.param("mailboxId").toLowerCase();
	await recordImageLoad(c, mailboxId, c.req.param("file"), ".png");
	const domain = mailboxId.slice(mailboxId.lastIndexOf("@") + 1);
	const png = atob(logos.get(domain) ?? signatureLogos.default);
	return imageResponse(c.req.method, Uint8Array.from(png, (byte) => byte.charCodeAt(0)), "image/png");
});

openTrackingApp.on(["GET", "HEAD"], "/pixel/:mailboxId/:file", async (c) => {
	await recordImageLoad(c, c.req.param("mailboxId").toLowerCase(), c.req.param("file"), ".gif");
	return imageResponse(c.req.method, PIXEL, "image/gif");
});
