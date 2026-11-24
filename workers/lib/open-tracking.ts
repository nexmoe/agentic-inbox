import { HTTPException } from "hono/http-exception";
import { renderEmailTemplate } from "../../shared/email-template.ts";

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

export interface PrepareOpenTrackingOptions {
	template?: boolean;
	subject?: string;
	senderName?: string;
}

/** Add the signature only to the delivered HTML so viewing Sent cannot trigger tracking. */
export function prepareOpenTracking(
	origin: string | undefined,
	mailboxId: string,
	enabled: boolean | undefined,
	html: string | undefined,
	text: string | undefined,
	options?: PrepareOpenTrackingOptions,
): { html: string | undefined; token?: string } {
	const address = mailboxId.toLowerCase();
	const useTemplate = Boolean(options?.template);
	const renderUntrackedTemplate = () => ({
		html: renderEmailTemplate({
			subject: options?.subject,
			senderName: options?.senderName,
			senderEmail: address,
			bodyHtml: html,
			bodyText: text,
			trackOpens: false,
		}),
	});

	if (enabled === false) return useTemplate ? renderUntrackedTemplate() : { html };
	const publicOrigin = trackingOrigin(origin);
	if (!publicOrigin) {
		if (enabled === undefined) return useTemplate ? renderUntrackedTemplate() : { html };
		throw new HTTPException(400, {
			res: Response.json({ error: "Open tracking is not configured for this installation. Turn off tracking or contact your administrator." }, { status: 400 }),
		});
	}
	const domain = escapeHtml(address.slice(address.lastIndexOf("@") + 1));
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
	const url = `${publicOrigin}/mail-signatures/${encodeURIComponent(address)}/${token}.png`;
	if (useTemplate) {
		return {
			token,
			html: renderEmailTemplate({
				subject: options?.subject,
				senderName: options?.senderName,
				senderEmail: address,
				bodyHtml: html,
				bodyText: text,
				trackOpens: true,
				logoUrl: url,
			}),
		};
	}
	const signature = `<p style="margin:16px 0 0"><img src="${escapeHtml(url)}" alt="" width="32" height="32" style="vertical-align:middle" referrerpolicy="no-referrer"> <span style="vertical-align:middle">${domain}</span></p>`;
	const content = html || `<div style="white-space:pre-wrap">${escapeHtml(text ?? "")}</div>`;
	const closingBody = /<\/body\s*>/i.exec(content);
	const offset = closingBody?.index ?? content.length;
	return { token, html: content.slice(0, offset) + signature + content.slice(offset) };
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
