import type { UnifiedEmailCursor } from "./unified-inbox";

export interface EmailSearchFilters {
	query: string;
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

export interface EmailSearchCursor extends Pick<UnifiedEmailCursor, "date" | "mailboxId" | "id"> {
	search: string;
}

export interface EmailSearchResult {
	id: string;
	subject: string;
	ai_title?: string | null;
	sender: string;
	recipient: string;
	date: string;
	read: boolean;
	starred: boolean;
	folder_id?: string | null;
	folder_name?: string | null;
	snippet?: string | null;
}

/** Bind a continuation to the exact search and filters that produced it. */
export function searchSignature(filters: EmailSearchFilters) {
	return JSON.stringify([
		filters.query.trim(), filters.folder ?? "", filters.from ?? "", filters.to ?? "",
		filters.subject ?? "", filters.date_start ?? "", filters.date_end ?? "",
		filters.is_read ?? null, filters.is_starred ?? null, filters.has_attachment ?? null,
	]);
}
