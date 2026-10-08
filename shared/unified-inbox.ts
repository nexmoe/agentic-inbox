export interface UnifiedEmailCursor {
	date: string;
	mailboxId: string;
	id: string;
	folder: string;
}

export interface UnifiedEmailPage<T> {
	emails: (T & { mailbox_id: string })[];
	totalCount: number;
	nextCursor: string | null;
}
