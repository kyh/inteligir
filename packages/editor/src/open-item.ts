import { createTSlatePlugin } from "platejs";
import type { PluginConfig } from "platejs";

interface OpenItemOptions {
  readonly itemId: string | null;
  readonly onFileKeep: (keep: Promise<void>) => void;
}

// oxlint-disable-next-line no-empty-function -- an editor made for no open note has no leave to hold
const noNoteWaits = () => {};

export const OpenItemPlugin = createTSlatePlugin<PluginConfig<"openItem", OpenItemOptions>>({
  key: "openItem",
  options: { itemId: null, onFileKeep: noNoteWaits },
});
