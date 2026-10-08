export interface EmailSummary {
	text: string;
	generatedAt: string;
	messageCount: number;
}

export type EmailSummaryState =
	| { status: "ready"; summary: EmailSummary }
	| { status: "pending"; queuedAt: string }
	| { status: "missing" }
	| { status: "error"; error: string };
