import { HTTPException } from "hono/http-exception";

export const OPEN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const OPEN_DEDUPLICATION_MS = 30_000;

export interface OpenClient {
	userAgent: string;
	asn?: number;
	purpose: string;
	fingerprint: string;
}

export function trackingOrigin(value: string | undefined): string | null {
	try {
		const url = new URL(value?.trim() ?? "");
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
		if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
		return url.origin;
	} catch {
		return null;
	}
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Build only the delivered HTML. The sender's stored copy never contains the pixel. */
export function prepareOpenTracking(
	origin: string | undefined,
	mailboxId: string,
	enabled: boolean | undefined,
	html: string | undefined,
	text: string | undefined,
): { html: string | undefined; token?: string } {
	if (!enabled) return { html };
	const publicOrigin = trackingOrigin(origin);
	if (!publicOrigin) throw new HTTPException(400, {
		res: Response.json({ error: "Open tracking is not configured for this installation. Turn off tracking or contact your administrator." }, { status: 400 }),
	});
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
	const url = `${publicOrigin}/pixel/${encodeURIComponent(mailboxId.toLowerCase())}/${token}.gif`;
	const pixel = `<img src="${escapeHtml(url)}" alt="" width="1" height="1" style="width:1px;height:1px;border:0;opacity:0" referrerpolicy="no-referrer">`;
	const content = html || `<div style="white-space:pre-wrap">${escapeHtml(text ?? "")}</div>`;
	const closingBody = /<\/body\s*>/i.exec(content);
	const offset = closingBody?.index ?? content.length;
	return { token, html: content.slice(0, offset) + pixel + content.slice(offset) };
}

/** Treat early delivery scans and recognizable prefetches as automation, not reads. */
export function automatedOpen(client: OpenClient, sentAt: number, openedAt: number): boolean {
	return openedAt - sentAt < 10_000
		|| client.asn === 714 || client.asn === 6185
		|| client.userAgent.trim() === "Mozilla/5.0"
		|| /bot\b|crawler|spider|headless|slurp|barracuda|proofpoint|mimecast|safelinks/i.test(client.userAgent)
		|| /prefetch|prerender/i.test(client.purpose);
}

/** A per-message hash deduplicates reloads without storing IP addresses or user agents. */
export async function openFingerprint(token: string, ip: string, userAgent: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${token}\0${ip.slice(0, 64)}\0${userAgent.slice(0, 512)}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
