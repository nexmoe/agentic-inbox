// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Dialog, Input, Text } from "@cloudflare/kumo";
import { FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { useActiveMailboxId } from "~/hooks/useActiveMailbox";
import { useComposeForm } from "~/hooks/useComposeForm";
import EmailTemplatePreview from "./EmailTemplatePreview";
import RichTextEditor from "./RichTextEditor";
import { useUIStore } from "~/hooks/useUIStore";
import OpenTrackingToggle from "./OpenTrackingToggle";

type ComposeViewMode = "write" | "split" | "preview";

export default function ComposeEmail() {
	const { folder } = useParams<{ folder: string }>();
	const mailboxId = useActiveMailboxId();
	const [viewMode, setViewMode] = useState<ComposeViewMode>("split");
	
	const { isComposeModalOpen, closeComposeModal } = useUIStore();

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
	} = useComposeForm(mailboxId, folder);

	return (
		<Dialog.Root
			open={isComposeModalOpen}
			onOpenChange={(open) => !open && !isSending && closeComposeModal()}
		>
			<Dialog size="lg" className="p-6 max-h-[85vh] overflow-y-auto">
				<Dialog.Title className="text-lg font-semibold mb-5">
					{formTitle}
				</Dialog.Title>
				<form onSubmit={(e) => handleSend(e, closeComposeModal)} className="space-y-4">
					{error && <Banner variant="error" text={error} />}
					<div className="flex items-center gap-2">
						<div className="flex-1">
							<Input
								label="To"
								type="text"
								placeholder="recipient@example.com, another@example.com"
								size="sm"
								value={to}
								onChange={(e) => setTo(e.target.value)}
								required
							/>
						</div>
						{!showCcBcc && (
							<button
								type="button"
								onClick={() => setShowCcBcc(true)}
								className="shrink-0 text-xs text-kumo-link hover:text-kumo-link-hover font-medium mt-5"
							>
								CC / BCC
							</button>
						)}
					</div>
					{showCcBcc && (
						<Input
							label="CC"
							type="text"
							size="sm"
							value={cc}
							onChange={(e) => setCc(e.target.value)}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					{showCcBcc && (
						<Input
							label="BCC"
							type="text"
							size="sm"
							value={bcc}
							onChange={(e) => setBcc(e.target.value)}
							placeholder="Separate multiple addresses with commas"
						/>
					)}
					<Input
						label="Subject"
						type="text"
						placeholder="Email subject"
						size="sm"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						required
					/>
					<div>
						<div className="flex items-center justify-between gap-2 mb-1.5">
							<Text size="sm" DANGEROUS_className="font-medium block">
								Message
							</Text>
							<div className="inline-flex rounded-lg border border-kumo-line bg-kumo-recessed p-0.5 text-xs">
								{(["write", "split", "preview"] as const).map((mode) => (
									<button
										key={mode}
										type="button"
										onClick={() => setViewMode(mode)}
										className={`px-2.5 py-0.5 rounded-md font-medium transition-colors ${
											viewMode === mode
												? "bg-kumo-base text-kumo-default shadow-xs"
												: "text-kumo-subtle hover:text-kumo-default"
										}`}
									>
										{mode === "write" ? "Write" : mode === "split" ? "Split" : "Preview"}
									</button>
								))}
							</div>
						</div>
						<div className={viewMode === "split" ? "grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch" : ""}>
							{viewMode !== "preview" && <RichTextEditor value={body} onChange={setBody} />}
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
					<div className="flex justify-between items-center pt-2">
						<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={closeComposeModal}
							disabled={isSending}
						>
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
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
