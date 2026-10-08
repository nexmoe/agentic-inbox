import { createContext, useContext } from "react";
import { useParams } from "react-router";

export const ActiveMailboxContext = createContext<{ mailboxId?: string } | null>(null);

/** In unified view, actions use the selected message's mailbox. */
export function useActiveMailboxId() {
	const context = useContext(ActiveMailboxContext);
	const { mailboxId } = useParams<{ mailboxId: string }>();
	return context ? context.mailboxId : mailboxId;
}
