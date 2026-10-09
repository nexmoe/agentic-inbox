import { Button, Input } from "@cloudflare/kumo";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useActiveMailboxId, useUnifiedMailbox } from "~/hooks/useActiveMailbox";
import { useUIStore } from "~/hooks/useUIStore";
import { fieldTouchClass } from "@/lib/type-scale";

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
		<form role="search" aria-label={unified ? "搜索所有邮箱" : "搜索当前邮箱"}
			className="flex shrink-0 items-center gap-2 border-b border-kumo-line px-4 py-2 md:px-5"
			onSubmit={(event) => {
				event.preventDefault();
				if (!query.trim() || (!unified && !mailboxId)) return;
				closePanel(); closeSidebar();
				navigate(`${base}/search?q=${encodeURIComponent(query.trim())}`);
			}}>
			<Input type="search" name="q" aria-label="搜索邮件" maxLength={1000}
				placeholder={unified ? "搜索所有邮箱的标题和正文…" : "搜索当前邮箱的标题和正文…"}
				className={`min-w-0 w-full ${fieldTouchClass}`} value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
					if (event.key === "Escape") clear();
				}} />
			{(query || urlQuery) && <Button type="button" variant="ghost" shape="square" icon={<XIcon size={16} />} aria-label="清除搜索" onClick={clear} className="shrink-0" />}
			<Button type="submit" variant="ghost" shape="square" icon={<MagnifyingGlassIcon size={18} />} aria-label="搜索" disabled={!query.trim()} className="shrink-0" />
		</form>
	);
}
