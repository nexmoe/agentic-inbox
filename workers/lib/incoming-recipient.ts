/** Route domain aliases into existing mailboxes without creating one per address. */
export function resolveIncomingMailbox(
	recipient: string,
	allowedAddresses: readonly string[],
	catchAll: Readonly<Record<string, string>> = {},
): string | undefined {
	const address = recipient.trim().toLowerCase();
	const at = address.lastIndexOf("@");
	if (at <= 0 || at === address.length - 1) return undefined;
	const allowed = new Set(allowedAddresses.map((value) => value.trim().toLowerCase()));
	if (allowed.size === 0 || allowed.has(address)) return address;

	const domain = address.slice(at + 1);
	const target = Object.entries(catchAll).find(([key]) => key.toLowerCase() === domain)?.[1].trim().toLowerCase();
	return target && allowed.has(target) ? target : undefined;
}
