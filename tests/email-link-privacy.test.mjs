import assert from "node:assert/strict";
import test from "node:test";
import { cleanEmailLink } from "../shared/email-link-privacy.ts";

test("removes known analytics parameters and keeps the original destination", () => {
	assert.equal(cleanEmailLink("https://example.org/verify?utm_source=mail&fbclid=abc&token=001234&utm_medium=email#verify"), "https://example.org/verify?token=001234#verify");
	assert.equal(cleanEmailLink("https://example.org/?UTM_SOURCE=a&%75tm_campaign=b&GCLID=c&mc_eid=d"), "https://example.org/");
});

test("preserves verification, payment and unsubscribe values byte for byte", () => {
	const url = "https://example.org/confirm?token=A%2bb%2Fc%3D&next=%2Finbox+folder&email=a%40b.org&expires=123&ref=invoice&utm_source=mail#keep%20this";
	assert.equal(cleanEmailLink(url), "https://example.org/confirm?token=A%2bb%2Fc%3D&next=%2Finbox+folder&email=a%40b.org&expires=123&ref=invoice#keep%20this");
	assert.equal(cleanEmailLink("https://example.org/unsubscribe?id=10&hash=abcdef"), "https://example.org/unsubscribe?id=10&hash=abcdef");
});

test("does not rewrite signed URLs or unknown parameters", () => {
	for (const signature of ["signature", "sig", "oauth_signature", "X-Amz-Signature", "X-Goog-Signature"]) {
		const url = `https://example.org/file?utm_source=email&${signature}=abc%2Bdef`;
		assert.equal(cleanEmailLink(url), url);
	}
	assert.equal(cleanEmailLink("https://example.org/?source=help&custom_campaign=a&ref=checkout"), "https://example.org/?source=help&custom_campaign=a&ref=checkout");
});

test("does not follow redirect wrappers or alter URI schemes and fragment queries", () => {
	const redirect = "https://click.example.org/go?url=https%3A%2F%2Fexample.org%2F%3Ftoken%3Dabc&utm_source=mail";
	assert.equal(cleanEmailLink(redirect), "https://click.example.org/go?url=https%3A%2F%2Fexample.org%2F%3Ftoken%3Dabc");
	for (const url of ["mailto:team@example.org?subject=Hello", "tel:+12025550123", "/relative?utm_source=mail", "https://example.org/#section?utm_source=keep", "https://example.org/?%broken=value"]) assert.equal(cleanEmailLink(url), url);
});
