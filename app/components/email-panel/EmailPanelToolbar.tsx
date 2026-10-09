// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import type { ReactNode } from "react";
import {
	ArchiveIcon,
	ArrowBendDoubleUpLeftIcon,
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	CodeIcon,
	DotsThreeVerticalIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { DropdownMenu, DropdownTrigger, DropdownContent, DropdownSeparator } from "@/components/ui/dropdown";
import { MenuItem } from "@/components/ui/menu-item";
import { Folders } from "shared/folders";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email?: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onReply?: () => void;
	onReplyAll?: () => void;
	onForward?: () => void;
	onToggleStar?: () => void;
	onToggleRead?: () => void;
	onMove?: (folderId: string) => void;
	onViewSource?: () => void;
	onDelete?: () => void;
}

function ToolbarAction({ label, icon, onClick, disabled, className }: {
	label: string;
	icon: ReactNode;
	onClick?: () => void;
	disabled?: boolean;
	className?: string;
}) {
	return <Tooltip content={label} side="bottom" asChild>
		<Button variant="ghost" shape="square" icon={icon} onClick={onClick} disabled={disabled || !onClick} aria-label={label} className={`h-9 w-9 shrink-0 ${className ?? ""}`} />
	</Tooltip>;
}

export default function EmailPanelToolbar({
	email, isDraftFolder, isSending, moveToFolders, onBack,
	onSendDraft, onEditDraft, onReply, onReplyAll, onForward,
	onToggleStar, onToggleRead, onMove, onViewSource, onDelete,
}: EmailPanelToolbarProps) {
	const disabled = !email;
	const canArchive = moveToFolders.some((folder) => folder.id === Folders.ARCHIVE);
	const readLabel = email?.read ? "Mark as unread" : "Mark as read";

	return (
		<div className="mail-pane-header gap-1 px-3 @[480px]:gap-2 @[480px]:px-4" data-mail-header="message" role="toolbar" aria-label="Email actions">
			<ToolbarAction label="Back to list" icon={<ArrowLeftIcon size={18} />} onClick={onBack} className="md:hidden" />
			{isDraftFolder ? <>
				<Button variant="primary" icon={<PaperPlaneTiltIcon size={18} />} onClick={onSendDraft} loading={isSending} className="h-9">{isSending ? "Sending…" : "Send"}</Button>
				<ToolbarAction label="Edit draft" icon={<PencilSimpleIcon size={18} />} onClick={onEditDraft} />
			</> : <ToolbarAction label="Archive" icon={<ArchiveIcon size={18} />} onClick={onMove ? () => onMove(Folders.ARCHIVE) : undefined} disabled={disabled || !canArchive} />}
			<DropdownMenu disabled={disabled || moveToFolders.length === 0}>
				<DropdownTrigger render={<Button variant="ghost" shape="square" icon={<FolderSimpleIcon size={18} />} aria-label="Move to folder" className="h-9 w-9 shrink-0" />} />
				<DropdownContent>
					{moveToFolders.map((folder, index) => <MenuItem key={folder.id} index={index} label={folder.name} icon={FolderSimpleIcon} onSelect={() => onMove?.(folder.id)} />)}
				</DropdownContent>
			</DropdownMenu>
			<ToolbarAction label="Delete" icon={<TrashIcon size={18} />} onClick={onDelete} disabled={disabled} />
			<div className="mx-1 h-6 w-px shrink-0 bg-kumo-line" />
			<ToolbarAction label={readLabel} icon={email?.read ? <EnvelopeSimpleIcon size={18} /> : <EnvelopeOpenIcon size={18} />} onClick={onToggleRead} disabled={disabled} />

			<div className="ml-auto flex items-center gap-1 @[480px]:gap-2">
				{!isDraftFolder && <>
					<ToolbarAction label="Reply" icon={<ArrowBendUpLeftIcon size={18} />} onClick={onReply} disabled={disabled} />
					<ToolbarAction label="Reply All" icon={<ArrowBendDoubleUpLeftIcon size={18} />} onClick={onReplyAll} disabled={disabled} className="hidden sm:inline-flex" />
					<ToolbarAction label="Forward" icon={<ArrowBendUpRightIcon size={18} />} onClick={onForward} disabled={disabled} className="hidden sm:inline-flex" />
				</>}
				<div className="mx-1 h-6 w-px shrink-0 bg-kumo-line" />
				<DropdownMenu disabled={disabled}>
					<DropdownTrigger render={<Button variant="ghost" shape="square" icon={<DotsThreeVerticalIcon size={18} />} aria-label="More email actions" className="h-9 w-9 shrink-0" />} />
					<DropdownContent align="end">
						<MenuItem index={0} label={email?.starred ? "Unstar" : "Star"} icon={StarIcon} onSelect={onToggleStar} />
						<MenuItem index={1} label="View source" icon={CodeIcon} onSelect={onViewSource} />
						{!isDraftFolder && <>
							<MenuItem index={2} label="Reply All" icon={ArrowBendDoubleUpLeftIcon} onSelect={onReplyAll} />
							<MenuItem index={3} label="Forward" icon={ArrowBendUpRightIcon} onSelect={onForward} />
						</>}
						<DropdownSeparator />
						<MenuItem index={isDraftFolder ? 2 : 4} label="Close email" icon={XIcon} onSelect={onBack} />
					</DropdownContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
