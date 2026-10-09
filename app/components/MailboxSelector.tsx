import { EnvelopeIcon, StackIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { IconComponentProps } from "@/lib/icon-context";
import MailboxLogo from "~/components/MailboxLogo";
import { SYSTEM_FOLDER_IDS, Folders } from "shared/folders";
import { useActiveMailboxId, useUnifiedMailbox } from "~/hooks/useActiveMailbox";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailboxes } from "~/queries/mailboxes";

export default function MailboxSelector() {
	const mailboxId = useActiveMailboxId();
	const unified = useUnifiedMailbox();
	const { data: mailboxes = [] } = useMailboxes();
	// Stable icon components keep loaded images mounted during selection changes.
	const mailboxLogos = useMemo(() => new Map(mailboxes.map((mailbox) => {
		const Logo = (props: IconComponentProps) => <MailboxLogo email={mailbox.email} {...props} />;
		return [mailbox.id, Logo] as const;
	})), [mailboxes]);
	const { folder } = useParams<{ folder: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const location = useLocation();
	const { closePanel, closeComposeModal, closeSidebar, selectMailbox } = useUIStore();

	const selectMailboxView = (value: string) => {
		if (!value || value === (unified ? "all" : mailboxId)) return;
		closePanel();
		closeComposeModal();
		closeSidebar();
		if (location.pathname.endsWith("/search")) {
			const query = searchParams.toString();
			if (value !== "all") selectMailbox(value);
			const base = value === "all" ? "/all" : `/mailbox/${encodeURIComponent(value)}`;
			navigate(`${base}/search${query ? `?${query}` : ""}`);
			return;
		}
		const targetFolder = (SYSTEM_FOLDER_IDS as readonly string[]).includes(folder ?? "") ? folder : Folders.INBOX;
		const query = searchParams.get("unread") === "true" ? "?unread=true" : "";
		if (value === "all") {
			navigate(`/all/emails/${targetFolder}${query}`);
		} else {
			selectMailbox(value);
			navigate(`/mailbox/${encodeURIComponent(value)}/emails/${targetFolder}${query}`);
		}
	};

	return (
		<Select value={unified ? "all" : mailboxId ?? ""} onValueChange={selectMailboxView}>
			<SelectTrigger
				aria-label="Switch mailbox"
				placeholder="Select mailbox"
				icon={unified ? StackIcon : mailboxLogos.get(mailboxId ?? "") ?? EnvelopeIcon}
				className="w-full min-w-0 rounded-md bg-kumo-base shadow-xs"
			/>
			<SelectContent className="min-w-64">
				<SelectItem index={0} value="all" icon={StackIcon}>All mail</SelectItem>
				{mailboxes.map((mailbox, index) => (
					<SelectItem key={mailbox.id} index={index + 1} value={mailbox.id} icon={mailboxLogos.get(mailbox.id)}>
						{mailbox.email}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
