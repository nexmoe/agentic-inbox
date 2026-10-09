import assert from "node:assert/strict";
import test from "node:test";
import { extractSummaryContent, codeOccursInBody, summaryLinksForMessage } from "../workers/lib/email-summary-content.ts";
import { isSummaryLinkUrl } from "../shared/email-summary.ts";

test("extracts nested and image buttons, unquoted attributes and encoded URLs without fetching", () => {
	const content = extractSummaryContent('<p>R&amp;D &#x4e2d;&#25991; &copy; 2026</p><a href=https://example.com/review?a=1&amp;b=2><span>Review <b>proposal</b></span></a><a href="//example.net/confirm"><img alt="Confirm email"></a><a href="https://example.com/review?a=1&amp;b=2">Duplicate</a>');
	assert.match(content.text, /R&D 中文 © 2026/);
	assert.deepEqual(content.links, [{ label: "Review proposal", url: "https://example.com/review?a=1&b=2" }, { label: "Confirm email", url: "https://example.net/confirm" }]);
});

test("omits hidden content and non-web destinations even in malformed HTML", () => {
	const content = extractSummaryContent('<head><title>Hidden title</title></head><script>hidden script</script><style>hidden style</style><!-- hidden comment --><div hidden>hidden 111111 <a href="https://hidden.example">Invisible</a></div><span style="display: none !important">hidden 222222</span><span aria-hidden="true">hidden 333333</span><a href="java&#115;cript:alert(1)">Unsafe</a><a href="data:text/html,test">Data</a><a href="/relative">Relative</a><a href="https://user:pass@example.com">Credentials</a><p>Visible <a href="https://example.com"><b>Read more');
	assert.doesNotMatch(content.text, /hidden/i);
	assert.deepEqual(content.links, [{ label: "Read more", url: "https://example.com" }]);
});

test("extracts plain-text URLs without sentence punctuation and preserves full query tokens", () => {
	const content = extractSummaryContent('Budget < $50 and > $10. Visit (https://example.com/Guide_(test)).\n验证链接 https://example.net/verify?token=a%2Bb&step=2。谢谢');
	assert.match(content.text, /Budget < \$50 and > \$10/);
	assert.deepEqual(content.links.map((link) => link.url), ["https://example.com/Guide_(test)", "https://example.net/verify?token=a%2Bb&step=2"]);
});

test("codes retain leading zeros, case and separators, and must match complete visible values", () => {
	const bodies = ["验证码：001234。 Login code: AB-12 CD. https://example.com/999999"];
	assert(codeOccursInBody("001234", bodies));
	assert(codeOccursInBody("AB-12 CD", bodies));
	for (const value of ["01234", "1234", "ab-12 cd", "999999", "555555"]) assert(!codeOccursInBody(value, bodies));
});

test("summary link destinations only accept absolute HTTP(S) without credentials or controls", () => {
	for (const url of ["https://example.com/path?q=1#section", "http://example.net"]) assert(isSummaryLinkUrl(url));
	for (const url of ["javascript:alert(1)", "data:text/html,test", "mailto:team@example.com", "//example.com", "/relative", "https://example.com\n/path", "https://user:pass@example.com", "https://example.com/" + "x".repeat(8192)]) assert(!isSummaryLinkUrl(url));
});

test("omits routine footer links but preserves them when they are the message's main topic", () => {
	const links = [
		{ label: "Verify email", url: "https://example.com/verify" },
		{ label: "Unsubscribe", url: "https://example.com/unsubscribe.php?id=1" },
		{ label: "Privacy policy", url: "https://example.com/privacy" },
		{ label: "Visit support", url: "https://example.com/help" },
	];
	assert.deepEqual(summaryLinksForMessage(links, "Your login code"), [links[0]]);
	assert.deepEqual(summaryLinksForMessage(links, "Confirm your unsubscribe request"), [links[0], links[1]]);
	assert.deepEqual(summaryLinksForMessage(links, "Privacy notice updated"), [links[0], links[2]]);
	assert.deepEqual(summaryLinksForMessage(links, "Support ticket update"), [links[0], links[3]]);
	assert.equal(summaryLinksForMessage([{ label: "Click here", url: "https://example.com/unsubscribe.php" }], "Newsletter").length, 0);
});
