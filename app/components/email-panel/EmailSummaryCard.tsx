import { Button, Loader } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEmailSummary } from "~/queries/emails";
import type { Email } from "~/types";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "~/queries/keys";
import { fontWeights } from "@/lib/font-weight";
import { typeClass } from "@/lib/type-scale";

export default function EmailSummaryCard({ mailboxId, email, revision, ready }: {
	mailboxId: string | undefined;
	email: Email;
	revision: string;
	ready: boolean;
}) {
	const { data, error, isPending, isFetching, refetch } = useEmailSummary(mailboxId, email, revision, ready);
	const [isGenerating, setIsGenerating] = useState(false);
	const [generationError, setGenerationError] = useState<string | null>(null);
	const qc = useQueryClient();
	const summary = data?.status === "ready" ? data.summary : undefined;
	const errorMessage = generationError || error?.message || (data?.status === "error" ? data.error : null);
	const waiting = isPending || data?.status === "pending" || isGenerating;
	useEffect(() => {
		if (!mailboxId || !summary?.title) return;
		void qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
		void qc.invalidateQueries({ queryKey: queryKeys.unifiedEmails.all });
		void qc.invalidateQueries({ queryKey: ["search", mailboxId] });
	}, [mailboxId, qc, summary?.title, summary?.generatedAt]);
	const generate = async () => {
		if (!mailboxId) return;
		setIsGenerating(true);
		setGenerationError(null);
		try {
			await api.summarizeEmail(mailboxId, email.id);
			await qc.invalidateQueries({ queryKey: ["email-summaries", mailboxId] });
		} catch (error) {
			setGenerationError((error as Error).message);
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<section aria-label="AI 邮件摘要" className="mx-4 mb-5 rounded-lg bg-muted p-3 md:mx-6" style={{ fontVariationSettings: fontWeights.normal }}>
			<div className="mb-1.5 flex flex-wrap items-center gap-1.5">
				<SparkleIcon size={14} className="shrink-0 text-kumo-brand" aria-hidden="true" />
				<h3 className={`${typeClass("caption")} text-foreground`} style={{ fontVariationSettings: fontWeights.semibold }}>AI 摘要</h3>
				{summary && summary.messageCount > 1 && <span className={`${typeClass("caption")} text-muted-foreground`}>· {summary.messageCount} 封邮件</span>}
			</div>
			<div aria-live="polite" aria-busy={waiting}>
				{waiting && !summary ? (
					<div className={`flex items-center gap-2 text-muted-foreground ${typeClass("body")}`}><Loader size="sm" /><span>正在总结邮件…</span></div>
				) : errorMessage ? (
					<div className="flex flex-wrap items-center gap-3">
						<p className={`${typeClass("body")} break-words text-muted-foreground`} role="alert">{errorMessage}</p>
						<Button size="sm" variant="secondary" icon={<ArrowClockwiseIcon size={14} />} disabled={isFetching || isGenerating} onClick={() => void (error ? refetch() : generate())}>重试</Button>
					</div>
				) : data?.status === "missing" ? (
					<div className="flex flex-wrap items-center gap-3"><p className={`${typeClass("body")} text-muted-foreground`}>这封历史邮件还没有摘要。</p><Button size="sm" variant="secondary" onClick={() => void generate()}>生成摘要</Button></div>
				) : (
					<>
						<p className={`whitespace-pre-wrap break-words text-foreground ${typeClass("body")}`}>{summary?.text}</p>
						{summary && !summary.title && <Button size="sm" variant="secondary" className="mt-3" disabled={isGenerating} onClick={() => void generate()}>{isGenerating ? "正在生成标题…" : "生成标题"}</Button>}
					</>
				)}
			</div>
		</section>
	);
}
