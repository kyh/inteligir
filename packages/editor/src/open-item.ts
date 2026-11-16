// The item an editor shows, by its id, and who hears a file kept for it: set where the editor is
// made (the item surface, a held item) and read from the editor, by what is drawn in it and by
// kits, which hold only the editor. An editor made for no item reads the defaults.

import { createTSlatePlugin } from "platejs";
import type { PluginConfig } from "platejs";

interface OpenItemOptions {
  readonly itemId: string | null;
  // A file is kept before the block that names it exists, so the editor's value says nothing of
  // one in flight: the open note hears each keep here, and a leave waits for its block to land.
  readonly onFileKeep: (keep: Promise<void>) => void;
}

const noNoteWaits = (): void => {
  // an editor made for no open note has no leave to hold
};

export const OpenItemPlugin = createTSlatePlugin<PluginConfig<"openItem", OpenItemOptions>>({
  key: "openItem",
  options: { itemId: null, onFileKeep: noNoteWaits },
});
