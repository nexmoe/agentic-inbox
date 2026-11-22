export interface EmailOpenTracking {
	enabled: boolean;
	openCount: number;
	firstOpenedAt: string | null;
	lastOpenedAt: string | null;
}

export interface EmailOpenTrackingSummary extends EmailOpenTracking {
	emailId: string;
}
