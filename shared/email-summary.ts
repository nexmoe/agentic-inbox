export interface EmailSummaryCode {
	label: string;
	value: string;
}

export interface EmailSummaryLink {
	label: string;
	url: string;
	kind: "action" | "link";
}

export interface EmailSummaryDetails {
	points: string[];
	codes: EmailSummaryCode[];
	links: EmailSummaryLink[];
}

export interface EmailSummary {
	/** Older saved summaries may not have a generated title yet. */
	title?: string;
	text: string;
	/** Absent on summaries saved before structured extraction was introduced. */
	details?: EmailSummaryDetails;
	generatedAt: string;
	messageCount: number;
}

export type EmailSummaryState =
	| { status: "ready"; summary: EmailSummary }
	| { status: "pending"; queuedAt: string }
	| { status: "missing" }
	| { status: "error"; error: string };

/** Only web destinations can be surfaced as summary actions. Never fetch them. */
export function isSummaryLinkUrl(value: string): boolean {
	if (value.length > 8_192 || /[\s\u0000-\u001f\u007f]/u.test(value)) return false;
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password;
	} catch {
		return false;
	}
}
