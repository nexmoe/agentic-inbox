export interface EmailSummary {
	/** Older saved summaries may not have a generated title yet. */
	title?: string;
	text: string;
	generatedAt: string;
	messageCount: number;
}

export type EmailSummaryState =
	| { status: "ready"; summary: EmailSummary }
	| { status: "pending"; queuedAt: string }
	| { status: "missing" }
	| { status: "error"; error: string };
