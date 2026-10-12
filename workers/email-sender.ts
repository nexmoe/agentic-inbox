// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

import { HTTPException } from "hono/http-exception";

function deliveryError(error: unknown): HTTPException {
	const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
	let status: 400 | 429 | 502 = 502;
	let message = "Cloudflare could not accept this email. Please try again.";
	switch (code) {
		case "E_SENDER_NOT_VERIFIED":
		case "E_SENDER_DOMAIN_NOT_AVAILABLE":
			status = 400;
			message = "Email sending is not enabled for this sender domain. Verify it in Cloudflare Email Sending.";
			break;
		case "E_RATE_LIMIT_EXCEEDED":
			status = 429;
			message = "The email sending limit has been reached. Please try again later.";
			break;
		case "E_RECIPIENT_NOT_ALLOWED":
		case "E_RECIPIENT_SUPPRESSED":
			status = 400;
			message = "Cloudflare cannot send to one or more recipients. Check the recipient addresses and suppression settings.";
			break;
		case "E_VALIDATION_ERROR":
		case "E_FIELD_MISSING":
		case "E_TOO_MANY_RECIPIENTS":
		case "E_TOO_MANY_ATTACHMENTS":
		case "E_CONTENT_TOO_LARGE":
			status = 400;
			message = "Cloudflare rejected this email. Check the recipients, message size, and attachments.";
	}
	return new HTTPException(status, { message, res: Response.json({ error: message }, { status }) });
}

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

/**
 * Send an email using the Cloudflare Email Service binding.
 *
 * @param binding  - The `EMAIL` SendEmail binding from env
 * @param params   - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws A safe JSON HTTP error when Cloudflare rejects the email
 */
export async function sendEmail(
	binding: SendEmail,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	try {
		const result = await binding.send(message as any);
		if (!result || typeof result.messageId !== "string" || !result.messageId) {
			throw new Error("Missing send acknowledgement");
		}
		return { messageId: result.messageId };
	} catch (error) {
		throw deliveryError(error);
	}
}
