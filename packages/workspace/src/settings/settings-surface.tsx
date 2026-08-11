import { Button } from "@repo/ui/components/button";

import { SettingsPanel } from "@repo/workspace/settings/settings-panel";
import { useViewStore } from "@repo/workspace/stores/view-store";

/**
 * Settings as a PLACE, not a dialog: one of the workspace's main surfaces, in
 * the same column the document uses and at the same reading width. A 512px
 * modal over the document made every section a scroll-in-a-scroll, and made
 * "where the user is" something the shell could not say — the breadcrumb names
 * this surface, so leaving it is the same gesture as leaving the graph.
 */
export function SettingsSurface() {
  const setSurface = useViewStore((s) => s.setSurface);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-8 pt-10 pb-24">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <Button variant="ghost" size="sm" onClick={() => setSurface("editor")}>
          Done
        </Button>
      </div>
      <SettingsPanel />
    </div>
  );
}
