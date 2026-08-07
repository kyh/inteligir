import { SettingsIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";

import { SettingsPanel } from "@repo/workspace/settings/settings-panel";
import { useViewStore } from "@repo/workspace/stores/view-store";

/**
 * Settings, reachable from the workspace gear. Controlled so panel actions that
 * navigate the workspace can close it first, and so a notice raised elsewhere in
 * the app can open it.
 */
export function SettingsDialog() {
  const open = useViewStore((s) => s.settingsOpen);
  const setOpen = useViewStore((s) => s.setSettingsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Settings"
            className="app-no-drag size-7 shrink-0 px-0 text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </Button>
        }
      />
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Settings</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] min-h-0 flex-1 overflow-auto">
          <SettingsPanel onRequestClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
