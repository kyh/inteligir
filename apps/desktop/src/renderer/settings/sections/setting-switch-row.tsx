import { Switch } from "@repo/ui/components/switch";

/** A labeled toggle row (the old fluid Switch bundled label + onToggle; the
 * stock switch is control-only, so the row lives here). */
export function SettingSwitchRow({
  label,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs">
      <span>{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onToggle} disabled={disabled} />
    </label>
  );
}
