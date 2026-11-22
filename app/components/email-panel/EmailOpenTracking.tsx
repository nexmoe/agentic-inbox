import { Button, Tooltip } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, EyeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "~/queries/keys";

export default function EmailOpenTracking({ mailboxId, emailId }: { mailboxId: string; emailId: string }) {
	const { data, isFetching, isError, refetch } = useQuery({
		queryKey: queryKeys.emailTracking.detail(mailboxId, emailId),
		queryFn: ({ signal }) => api.getEmailOpenTracking(mailboxId, emailId, { signal }),
		staleTime: 30_000,
	});
	if (data && !data.enabled) return null;
	const count = data?.openCount ?? 0;
	const label = isError ? "Open tracking unavailable" : !data ? "Loading open tracking…"
		: count === 0 ? "No opens recorded" : count === 1 ? "Opened once" : `Opened ${count} times`;
	const timestamps = data?.firstOpenedAt && data.lastOpenedAt
		? `First: ${new Date(data.firstOpenedAt).toLocaleString()}. Last: ${new Date(data.lastOpenedAt).toLocaleString()}. ` : "";
	return (
		<div className="mt-2 flex items-center gap-1 text-xs text-kumo-subtle">
			<Tooltip content={`${timestamps}Counts image loads, not confirmed reads. Known automated fetches are excluded; recipients are not identified.`} asChild>
				<span className="inline-flex items-center gap-1.5" tabIndex={0}>
					<EyeIcon size={14} className={count > 0 ? "text-kumo-success" : undefined} />
					<span aria-live="polite">{label}</span>
				</span>
			</Tooltip>
			<Button type="button" variant="ghost" shape="square" size="xs" icon={<ArrowClockwiseIcon size={12} />}
				aria-label="Refresh open tracking" disabled={isFetching} onClick={() => void refetch()} />
		</div>
	);
}
