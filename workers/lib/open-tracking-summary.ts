import type { EmailOpenTrackingSummary } from "../../shared/email-tracking";

/** Keep tracking tokens and client data out of message and list responses. */
export function withOpenTracking<T extends Record<string, unknown>>(row: T) {
	const { tracking_email_id, tracking_enabled, tracking_open_count, tracking_first_opened_at, tracking_last_opened_at, ...email } = row;
	const open_tracking: EmailOpenTrackingSummary | null = tracking_email_id ? {
		emailId: String(tracking_email_id),
		enabled: !!tracking_enabled,
		openCount: Number(tracking_open_count ?? 0),
		firstOpenedAt: tracking_first_opened_at == null ? null : new Date(Number(tracking_first_opened_at)).toISOString(),
		lastOpenedAt: tracking_last_opened_at == null ? null : new Date(Number(tracking_last_opened_at)).toISOString(),
	} : null;
	return { ...email, open_tracking };
}
