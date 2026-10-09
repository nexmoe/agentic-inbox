import { Button } from "@cloudflare/kumo";
import { ListIcon } from "@phosphor-icons/react";
import { useUIStore } from "~/hooks/useUIStore";

export default function MobileSidebarToggle() {
	const toggleSidebar = useUIStore((state) => state.toggleSidebar);
	return <Button variant="ghost" shape="square" icon={<ListIcon size={20} />} onClick={toggleSidebar} aria-label="Toggle sidebar" className="lg:hidden shrink-0" />;
}
