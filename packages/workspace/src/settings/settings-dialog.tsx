import { SettingsIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@repo/ui/components/tabs";

import { ConnectorsPanel } from "@repo/workspace/settings/connectors-panel";
import { SettingsPanel } from "@repo/workspace/settings/settings-panel";
import { useViewStore } from "@repo/workspace/stores/view-store";

/**
 * Settings + Connectors, reachable from the workspace gear. Replaces the old
 * settings/extensions widget panels — same content, now a dialog instead of a
 * grid tile. Controlled so panel actions that navigate the workspace (e.g.
 * opening a conflicted note from Settings → Sync) can close it first, and so
 * a notice raised elsewhere in the app can open it (the sync-hold toast).
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
        <Tabs defaultValue="general" className="flex max-h-[70vh] min-h-0 flex-col">
          <TabsList className="px-3 pt-2">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="connectors">Connectors</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto">
            <TabsContent value="general">
              <SettingsPanel onRequestClose={() => setOpen(false)} />
            </TabsContent>
            <TabsContent value="connectors">
              <ConnectorsPanel />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
