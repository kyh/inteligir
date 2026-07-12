import { useEffect } from "react";
import { Label } from "@repo/ui/components/label";

import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import { useAiSettingsStore } from "@renderer/stores/ai-settings-store";

// Ghost text is on by default (potion behavior); the switch opts out for
// users who'd rather not spend tokens on every typing pause. The model
// picker names the fast tier the host would use by default.
export function EditorAiSection() {
  const loaded = useAiSettingsStore((s) => s.loaded);
  const enabled = useAiSettingsStore((s) => s.ghostTextEnabled);
  const model = useAiSettingsStore((s) => s.ghostTextModel);
  const models = useAiSettingsStore((s) => s.models);
  const defaultModelId = useAiSettingsStore((s) => s.defaultModelId);
  const init = useAiSettingsStore((s) => s.init);
  const setEnabled = useAiSettingsStore((s) => s.setGhostTextEnabled);
  const setModel = useAiSettingsStore((s) => s.setGhostTextModel);

  useEffect(() => {
    void init();
  }, [init]);

  const effectiveId = model ?? defaultModelId;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Editor AI</Label>
      <div className="rounded-[12px] bg-muted">
        <SettingSwitchRow
          label="Ghost text completions"
          checked={enabled}
          onToggle={() => void setEnabled(!enabled)}
          disabled={!loaded}
        />
        <p className="px-3 pb-2 text-[10px] text-muted-foreground">
          Grey inline completions after a typing pause — Tab accepts, Escape dismisses. Runs on a
          fast model with your OpenAI account.
        </p>
        {enabled && models.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="text-xs text-foreground">Completion model</span>
            {/* Native select: a portaled Base UI menu popup inside the
                settings Dialog reads as an outside press and dismisses it. */}
            <select
              value={effectiveId ?? ""}
              onChange={(e) => void setModel(e.target.value)}
              className="h-6 max-w-[55%] rounded-md bg-card px-1.5 text-[10px] font-medium text-muted-foreground shadow-surface-2 outline-none transition-colors hover:text-foreground"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === defaultModelId ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
