const TRACKING_PARAMETERS = new Set([
	"fbclid", "gclid", "dclid", "msclkid", "twclid", "ttclid", "yclid",
	"mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi", "vero_id", "vero_conv",
]);

/** Remove only known analytics parameters, preserving every other query byte. */
export function cleanEmailLink(url: string): string {
	let parsed: URL;
	try { parsed = new URL(url); } catch { return url; }
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return url;
	const keys = [...parsed.searchParams.keys()].map((key) => key.toLowerCase());
	// Signed download/payment URLs may cover the entire query, including analytics.
	if (keys.some((key) => /^(?:sig|signature|oauth_signature|x-amz-.+|x-goog-.+)$/.test(key))) return url;
	const queryStart = url.indexOf("?");
	const hashStart = url.indexOf("#");
	if (queryStart < 0 || (hashStart >= 0 && hashStart < queryStart)) return url;
	const end = hashStart < 0 ? url.length : hashStart;
	const parts = url.slice(queryStart + 1, end).split("&");
	const kept = parts.filter((part) => {
		let key: string;
		try { key = decodeURIComponent(part.split("=", 1)[0].replaceAll("+", " ")).toLowerCase(); }
		catch { return true; }
		return !key.startsWith("utm_") && !TRACKING_PARAMETERS.has(key);
	});
	if (kept.length === parts.length) return url;
	return url.slice(0, queryStart) + (kept.length ? `?${kept.join("&")}` : "") + url.slice(end);
}
