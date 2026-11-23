import { Button, Tooltip } from "@cloudflare/kumo";
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";

export default function OpenTrackingToggle({ checked, available, disabled, onChange }: {
	checked: boolean; available: boolean; disabled: boolean; onChange: (checked: boolean) => void;
}) {
	return (
		<Tooltip content={available
			? "Track loads of the sender-domain signature logo. Mail apps may block it or load it automatically."
			: "Open tracking is not configured for this installation."} asChild>
			<span>
				<Button type="button" variant={checked ? "secondary" : "ghost"} size="sm"
					aria-label="Track email opens" aria-pressed={checked}
					disabled={disabled || (!available && !checked)} onClick={() => onChange(!checked)}
					icon={checked ? <EyeIcon size={16} /> : <EyeSlashIcon size={16} />}>
					<span className="hidden sm:inline">Track opens</span>
				</Button>
			</span>
		</Tooltip>
	);
}
