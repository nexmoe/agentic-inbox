import { Button, Input } from "@cloudflare/kumo";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useActiveMailboxId, useUnifiedMailbox } from "~/hooks/useActiveMailbox";
import { useUIStore } from "~/hooks/useUIStore";
import { fieldTouchClass, typeClass } from "@/lib/type-scale";
import { spring } from "@/lib/springs";

export default function MailSearch() {
	const unified = useUnifiedMailbox();
	const mailboxId = useActiveMailboxId();
	const navigate = useNavigate();
	const location = useLocation();
	const [params] = useSearchParams();
	const urlQuery = location.pathname.endsWith("/search") ? params.get("q") || "" : "";
	const [query, setQuery] = useState(urlQuery);
	const { closePanel, closeSidebar } = useUIStore();
	const base = unified ? "/all" : `/mailbox/${encodeURIComponent(mailboxId || "")}`;
	useEffect(() => { setQuery(urlQuery); }, [urlQuery, location.pathname]);
	const clear = () => {
		setQuery("");
		if (urlQuery) { closePanel(); navigate(`${base}/emails/inbox`); }
	};

	return (
		<form role="search" aria-label={unified ? "Search all mailboxes" : "Search current mailbox"}
			className="flex h-12 shrink-0 items-center gap-1 border-b border-kumo-line px-4 transition-colors focus-within:border-muted-foreground md:px-5"
			style={{ transitionDuration: `${spring.fast.duration}s` }}
			onSubmit={(event) => {
				event.preventDefault();
				if (!query.trim() || (!unified && !mailboxId)) return;
				closePanel(); closeSidebar();
				navigate(`${base}/search?q=${encodeURIComponent(query.trim())}`);
			}}>
			<Input type="search" name="q" aria-label="Search messages" maxLength={1000}
				placeholder={unified ? "Search all mailboxes…" : "Search this mailbox…"}
				className={`h-7 min-w-0 w-full rounded-none bg-transparent px-0 ring-0 focus:ring-0 ${typeClass("body")} ${fieldTouchClass}`} value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
					if (event.key === "Escape") clear();
				}} />
			{(query || urlQuery) && <Button type="button" variant="ghost" shape="square" size="sm" icon={<XIcon size={14} />} aria-label="Clear search" onClick={clear} className="size-7 shrink-0" />}
			<Button type="submit" variant="ghost" shape="square" size="sm" icon={<MagnifyingGlassIcon size={16} />} aria-label="Search" disabled={!query.trim()} className="size-7 shrink-0" />
		</form>
	);
}
