export function getSenderDetails(sender?: string | null) {
	const raw = sender?.trim() || "";
	const match = raw.match(/^(.*?)\s*<([^<>]+)>\s*$/);
	const name = match?.[1].trim().replace(/^"(.*)"$/, "$1") || "";
	const address = (match?.[2] || raw).trim();
	const hostname = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
	let domain: string | undefined;
	if (address.includes("@") && /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u.test(hostname)) {
		try { domain = new URL(`https://${hostname}`).hostname; } catch { /* Use initials for invalid domains. */ }
	}
	return { name, address, label: name || address || "?", domain };
}
