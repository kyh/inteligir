// URL prompt for the slash menu's Embed item. The slash combobox unmounts
// itself on selection, so the item can't host UI — it calls the module-level
// opener and this host (rendered from SlashKit's render.afterEditable, inside
// the Plate context) shows the dialog and routes the URL to
// insertEmbedFromUrl. Same runner-bridge pattern as triggerInlineAi.

import { useEffect, useState } from "react";
import { useEditorRef } from "platejs/react";

import { Button } from "@repo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Input } from "@repo/ui/components/input";

import { useEditorPane } from "@repo/app/editor/editor-pane-context";
import { insertEmbedFromUrl } from "@repo/app/editor/kits/embed-kit";

let activeOpener: (() => void) | null = null;

/** Open the embed URL prompt (callable from outside React, e.g. slash items). */
export function openEmbedUrlDialog(): void {
  activeOpener?.();
}

export function EmbedUrlDialogHost() {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  // One host mounts per open tab (#369) but the module-level opener is a
  // single global slot — only the ACTIVE pane's host claims it, so the slash
  // menu (which always runs on the active editor) can't open a dialog that
  // inserts into a hidden tab.
  const paneActive = useEditorPane()?.active ?? true;
  useEffect(() => {
    if (!paneActive) return;
    const opener = () => {
      setUrl("");
      setOpen(true);
    };
    activeOpener = opener;
    return () => {
      if (activeOpener === opener) activeOpener = null;
    };
  }, [paneActive]);

  // The dialog itself PORTALS to <body>, so a tab switch (the pane hides but
  // never unmounts, #369) would leave it floating over the next tab, with
  // Insert targeting the now-hidden document. Close on deactivate — same
  // semantics as dismissing it.
  useEffect(() => {
    if (!paneActive) setOpen(false);
  }, [paneActive]);

  const trimmed = url.trim();

  const submit = () => {
    if (!trimmed) return;
    setOpen(false);
    insertEmbedFromUrl(editor, trimmed);
    editor.tf.focus();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed from URL</DialogTitle>
          <DialogDescription>
            YouTube video, tweet, PDF, or any page (renders as an iframe).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <Button variant="primary" size="sm" onClick={submit} disabled={!trimmed}>
            Embed
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
