import { Tooltip } from "@cloudflare/kumo";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { typeClass } from "@/lib/type-scale";
import type { EmailOpenTracking } from "../../../shared/email-tracking";

export default function EmailOpenStatus({ tracking, latestSent = false, loading = false, unavailable = false }: {
	tracking?: EmailOpenTracking | null;
	latestSent?: boolean;
	loading?: boolean;
	unavailable?: boolean;
}) {
	const count = tracking?.openCount ?? 0;
	const label = unavailable ? "Open tracking unavailable" : loading ? "Loading open tracking…"
		: !tracking?.enabled ? "Not tracked" : count === 0 ? "No opens recorded"
		: count === 1 ? "Opened" : `Opened ${count} times`;
	const state = unavailable ? "unavailable" : loading ? "loading" : !tracking?.enabled ? "untracked" : count > 0 ? "opened" : "pending";
	const timestamps = tracking?.firstOpenedAt && tracking.lastOpenedAt
		? `First: ${new Date(tracking.firstOpenedAt).toLocaleString()}. Last: ${new Date(tracking.lastOpenedAt).toLocaleString()}. ` : "";
	const description = state === "untracked"
		? "Tracking was off when this message was sent. It cannot be enabled retroactively."
		: `${timestamps}Counts image loads, not confirmed reads. Mail apps may block images or load them automatically; recipients are not identified.`;
	const Icon = state === "untracked" ? EyeSlashIcon : EyeIcon;
	return (
		<Tooltip content={`${latestSent ? "Latest sent message. " : ""}${description}`} asChild>
			<span data-mail-open-status={state} aria-label={`${latestSent ? "Latest sent message: " : ""}${label}`}
				className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${typeClass("caption")} ${state === "opened" ? "text-foreground" : "text-muted-foreground"}`}
				tabIndex={0}>
				<Icon size={14} aria-hidden="true" />
				<span aria-live="polite">{label}</span>
			</span>
		</Tooltip>
	);
}
