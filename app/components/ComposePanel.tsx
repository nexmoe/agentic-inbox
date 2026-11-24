// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import { FloppyDiskIcon, PaperPlaneTiltIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";
import { useComposeForm } from "~/hooks/useComposeForm";
import EmailTemplatePreview from "./EmailTemplatePreview";
import RichTextEditor from "./RichTextEditor";
import OpenTrackingToggle from "./OpenTrackingToggle";

type ComposeViewMode = "write" | "split" | "preview";

export default function ComposePanel() {
	const { folder } = useParams<{ folder: string }>();
	const mailboxId = useActiveMailboxId();
	const [viewMode, setViewMode] = useState<ComposeViewMode>("split");

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		trackOpens,
		setTrackOpens,
		trackingAvailable,
		senderName,
		senderEmail,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId, folder);

	return (
		<div className="flex flex-col h-full bg-kumo-base">
			<div className="mail-pane-header justify-between px-4 md:px-6" data-mail-header="compose">
				<h2 className="text-base font-semibold text-kumo-default">
					{formTitle}
				</h2>
				<div className="flex items-center gap-2">
					<div className="inline-flex rounded-lg border border-kumo-line bg-kumo-recessed p-0.5 text-xs">
						{(["write", "split", "preview"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								onClick={() => setViewMode(mode)}
								className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
									viewMode === mode
										? "bg-kumo-base text-kumo-default shadow-xs"
										: "text-kumo-subtle hover:text-kumo-default"
								}`}
							>
								{mode === "write" ? "Write" : mode === "split" ? "Split" : "Preview"}
							</button>
						))}
					</div>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={closeCompose}
						disabled={isSending}
						aria-label="Close compose"
					/>
				</div>
			</div>

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex flex-col flex-1 min-h-0 overflow-y-auto"
			>
				<div className="p-4 md:p-6 space-y-4">
					{error && <Banner variant="error" text={error} />}

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								To
							</label>
							<div className="flex-1 flex items-center gap-2 min-w-0">
								<Input
									type="text"
									placeholder="recipient@example.com"
									size="sm"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									required
								/>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium"
									>
										CC / BCC
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									CC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={cc}
										onChange={(e) => setCc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
									BCC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={bcc}
										onChange={(e) => setBcc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="text-sm font-medium text-kumo-subtle w-14 shrink-0">
								Subject
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="Email subject"
									size="sm"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					<div className={viewMode === "split" ? "grid grid-cols-1 @[600px]:grid-cols-2 gap-4 items-stretch" : ""}>
						{viewMode !== "preview" && (
							<RichTextEditor
								value={body}
								onChange={setBody}
							/>
						)}
						{viewMode !== "write" && (
							<EmailTemplatePreview
								subject={subject}
								bodyHtml={body}
								senderName={senderName}
								senderEmail={senderEmail}
								trackOpens={trackOpens}
								trackingAvailable={trackingAvailable}
							/>
						)}
					</div>
				</div>

				{/* Footer actions */}
				<div className="mt-auto px-4 py-3 border-t border-kumo-line bg-kumo-fill/30 shrink-0 md:px-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-1">
						<Button type="button" variant="ghost" size="sm" onClick={closeCompose} disabled={isSending}>
							Discard
						</Button>
						<OpenTrackingToggle checked={trackOpens} available={trackingAvailable} disabled={isSending || isSavingDraft} onChange={setTrackOpens} />
						</div>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
