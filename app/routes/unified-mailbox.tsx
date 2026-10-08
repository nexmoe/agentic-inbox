import { useEffect } from "react";
import { ActiveMailboxContext } from "~/hooks/useActiveMailbox";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailboxes } from "~/queries/mailboxes";
import MailboxRoute from "./mailbox";

export default function UnifiedMailboxRoute() {
	const { data: mailboxes = [] } = useMailboxes();
	const { selectedMailboxId, closePanel, closeComposeModal, closeSidebar } = useUIStore();
	const mailboxId = mailboxes.some((mailbox) => mailbox.id === selectedMailboxId)
		? selectedMailboxId : mailboxes[0]?.id;
	useEffect(() => {
		closePanel();
		closeComposeModal();
		closeSidebar();
	}, [closePanel, closeComposeModal, closeSidebar]);
	return <ActiveMailboxContext.Provider value={{ mailboxId }}><MailboxRoute unified /></ActiveMailboxContext.Provider>;
}
