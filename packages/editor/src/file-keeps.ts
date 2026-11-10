// A file is kept before the block that names it exists, so an editor's value says nothing of one in
// flight: the open note watches its editor's keeps here, and a leave waits for each block to land.

import type { SlateEditor } from "platejs";

type FileKeepWatcher = (keep: Promise<void>) => void;

const watchers = new WeakMap<SlateEditor, FileKeepWatcher>();

export const watchFileKeeps = (editor: SlateEditor, watch: FileKeepWatcher): void => {
  watchers.set(editor, watch);
};

export const announceFileKeep = (editor: SlateEditor, keep: Promise<void>): void => {
  watchers.get(editor)?.(keep);
};
