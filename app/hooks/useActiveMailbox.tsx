import { createContext, useContext } from "react";
import { useParams } from "react-router";

export const ActiveMailboxContext = createContext<{ mailboxId?: string; unified: boolean } | null>(null);

export function useUnifiedMailbox() {
	return useContext(ActiveMailboxContext)?.unified ?? false;
}

/** In unified view, actions use the selected message's mailbox. */
export function useActiveMailboxId() {
	const context = useContext(ActiveMailboxContext);
	const { mailboxId } = useParams<{ mailboxId: string }>();
	return context ? context.mailboxId : mailboxId;
}
