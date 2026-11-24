export interface EmailTemplateOptions {
	subject?: string;
	senderName?: string;
	senderEmail: string;
	bodyHtml?: string;
	bodyText?: string;
	trackOpens: boolean;
	logoUrl?: string;
	emptyPlaceholder?: string;
}

export function escapeEmailHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => (
		{ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!
	));
}

export function extractDomainFromAddress(address: string): string {
	const normalized = address.trim().toLowerCase();
	const atIndex = normalized.lastIndexOf("@");
	return atIndex >= 0 ? normalized.slice(atIndex + 1) : normalized;
}

function isBlankRichText(html: string): boolean {
	const stripped = html
		.replace(/<br\s*\/?>/gi, "")
		.replace(/<\/?(?:p|div|span)\b[^>]*>/gi, "")
		.replace(/&nbsp;/gi, " ")
		.trim();
	return stripped.length === 0;
}

export function extractEmailBodyContent(
	html?: string,
	text?: string,
	emptyPlaceholder?: string,
): string {
	if (html && !isBlankRichText(html)) {
		const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
		return bodyMatch ? bodyMatch[1] : html;
	}
	if (text && text.trim().length > 0) {
		return `<div style="white-space:pre-wrap;color:#1d1d1f;font-size:16px;line-height:27px;">${escapeEmailHtml(text)}</div>`;
	}
	if (emptyPlaceholder) {
		return `<p style="margin:0;color:#86868b;font-size:16px;line-height:27px;">${escapeEmailHtml(emptyPlaceholder)}</p>`;
	}
	return `<p style="margin:0;color:#1d1d1f;font-size:16px;line-height:27px;"></p>`;
}

export function renderEmailTemplate(options: EmailTemplateOptions): string {
	const senderEmail = options.senderEmail.trim();
	const domain = extractDomainFromAddress(senderEmail) || "mail";
	const fallbackName = senderEmail.split("@")[0] || domain;
	const senderName = options.senderName?.trim() || fallbackName;
	const tracked = Boolean(options.trackOpens && options.logoUrl);

	const bodyContent = extractEmailBodyContent(
		options.bodyHtml,
		options.bodyText,
		options.emptyPlaceholder,
	);

	const headerRow = tracked
		? `<tr>
			<td width="56" valign="middle" style="padding:0;vertical-align:middle;width:56px;">
				<img src="${escapeEmailHtml(options.logoUrl!)}" alt="${escapeEmailHtml(domain)}" width="44" height="44" referrerpolicy="no-referrer" style="display:block;border-radius:12px;margin:0;" />
			</td>
			<td valign="middle" style="padding:0;vertical-align:middle;">
				<div style="color:#1d1d1f;font-size:18px;font-weight:650;letter-spacing:-0.02em;line-height:22px;margin:0 0 2px 0;">${escapeEmailHtml(senderName)}</div>
				<div style="color:#6e6e73;font-size:11px;font-weight:500;letter-spacing:0.04em;line-height:16px;margin:0;">${escapeEmailHtml(domain)}</div>
			</td>
		</tr>`
		: `<tr>
			<td valign="middle" style="padding:0;vertical-align:middle;">
				<div style="color:#1d1d1f;font-size:18px;font-weight:650;letter-spacing:-0.02em;line-height:22px;margin:0 0 2px 0;">${escapeEmailHtml(senderName)}</div>
				<div style="color:#86868b;font-size:11px;font-weight:500;letter-spacing:0.04em;line-height:16px;margin:0;">${escapeEmailHtml(domain)}</div>
			</td>
		</tr>`;

	return `<div data-email-template="default" data-track-state="${tracked ? "tracked" : "untracked"}" style="background-color:transparent;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif;margin:0;padding:0;">
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;margin:0 auto;border-collapse:collapse;">
		<tr>
			<td style="padding:40px 28px 48px 28px;">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
					<tr>
						<td style="padding:0 0 24px 0;">
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
								${headerRow}
							</table>
						</td>
					</tr>
					<tr>
						<td style="padding:0;">
							<div style="border-top:1px solid #dedbd6;height:1px;line-height:1px;"></div>
						</td>
					</tr>
					<tr>
						<td style="padding:36px 0 40px 0;color:#1d1d1f;font-size:16px;line-height:27px;">
							${bodyContent}
						</td>
					</tr>
					<tr>
						<td style="padding:0;">
							<div style="border-top:1px solid #dedbd6;height:1px;line-height:1px;"></div>
						</td>
					</tr>
					<tr>
						<td style="padding:22px 0 0 0;">
							<div style="color:#6e6e73;font-size:12px;line-height:19px;margin:0;">${escapeEmailHtml(senderName)} &middot; ${escapeEmailHtml(senderEmail)}</div>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</div>`;
}
