import { Button, Loader } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEmailSummary } from "~/queries/emails";
import type { Email } from "~/types";

export default function EmailSummaryCard({ mailboxId, email, revision, ready }: {
	mailboxId: string | undefined;
	email: Email;
	revision: string;
	ready: boolean;
}) {
	const { data, error, isPending, isFetching, refetch } = useEmailSummary(mailboxId, email, revision, ready);

	return (
		<section aria-label="AI 邮件摘要" className="mx-4 my-4 rounded-lg border border-kumo-line bg-kumo-fill/30 p-4 md:mx-6">
			<div className="mb-2 flex items-center gap-2 text-sm font-medium text-kumo-default">
				<SparkleIcon size={16} className="text-kumo-brand" />
				<span>AI 摘要</span>
				{data && <span className="ml-auto text-xs font-normal text-kumo-subtle">{data.messageCount > 1 ? `${data.messageCount} 封邮件的完整会话` : "完整邮件"}</span>}
			</div>
			<div aria-live="polite" aria-busy={isPending || isFetching}>
				{(isPending || isFetching) && !data ? (
					<div className="flex items-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /><span>正在总结邮件…</span></div>
				) : error ? (
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-sm text-kumo-subtle" role="alert">{error.message || "暂时无法生成摘要。"}</p>
						<Button size="sm" variant="secondary" icon={<ArrowClockwiseIcon size={14} />} disabled={isFetching} onClick={() => void refetch()}>重试</Button>
					</div>
				) : (
					<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-kumo-default">{data?.text}</p>
				)}
			</div>
		</section>
	);
}
