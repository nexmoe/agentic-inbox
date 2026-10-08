// Store and forward independently so a storage failure cannot skip the Gmail copy.
export async function deliverIncomingEmail(
	storeEmail: () => Promise<void>,
	forwardEmail?: () => Promise<unknown>,
): Promise<void> {
	const deliveries: Promise<unknown>[] = [Promise.resolve().then(storeEmail)];
	if (forwardEmail) deliveries.push(Promise.resolve().then(forwardEmail));
	const results = await Promise.allSettled(deliveries);
	for (const result of results) {
		if (result.status === "rejected") throw result.reason;
	}
}
