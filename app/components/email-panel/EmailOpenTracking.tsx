import { Button } from "@cloudflare/kumo";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "~/queries/keys";
import EmailOpenStatus from "./EmailOpenStatus";
import type { EmailOpenTracking as OpenTrackingData } from "../../../shared/email-tracking";

export default function EmailOpenTracking({ mailboxId, emailId, initialTracking }: {
	mailboxId: string; emailId: string; initialTracking?: OpenTrackingData | null;
}) {
	const { data, isFetching, isError, refetch } = useQuery({
		queryKey: queryKeys.emailTracking.detail(mailboxId, emailId),
		queryFn: ({ signal }) => api.getEmailOpenTracking(mailboxId, emailId, { signal }),
		staleTime: 30_000,
		initialData: initialTracking ?? undefined,
		initialDataUpdatedAt: 0,
	});
	return (
		<div className="mt-2 flex items-center gap-1 text-xs text-kumo-subtle">
			<EmailOpenStatus tracking={data} loading={!data && !isError} unavailable={isError} />
			<Button type="button" variant="ghost" shape="square" size="xs" icon={<ArrowClockwiseIcon size={12} />}
				aria-label="Refresh open tracking" disabled={isFetching} onClick={() => void refetch()} />
		</div>
	);
}
