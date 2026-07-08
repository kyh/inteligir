import { useState } from "react";
import { SettingsIcon } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import { Tabs, TabsList, TabItem, TabPanel } from "@repo/ui/components/tabs";

import { ExtensionsPanel } from "@renderer/settings/extensions-panel";
import { SettingsPanel } from "@renderer/settings/settings-panel";

/**
 * Settings + Connectors, reachable from the workspace gear. Replaces the old
 * settings/extensions widget panels — same content, now a dialog instead of a
 * grid tile. Controlled so panel actions that navigate the workspace (e.g.
 * opening a conflicted note from Settings → Sync) can close it first.
 */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
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
            <TabItem value="general" label="General" />
            <TabItem value="connectors" label="Connectors" />
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto">
            <TabPanel value="general">
              <SettingsPanel onRequestClose={() => setOpen(false)} />
            </TabPanel>
            <TabPanel value="connectors">
              <ExtensionsPanel />
            </TabPanel>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
