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

import { insertEmbedFromUrl } from "@renderer/editor/kits/embed-kit";

let activeOpener: (() => void) | null = null;

/** Open the embed URL prompt (callable from outside React, e.g. slash items). */
export function openEmbedUrlDialog(): void {
  activeOpener?.();
}

export function EmbedUrlDialogHost() {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  // The module-level opener is a single global slot claimed by the one
  // mounted editor's host, so the slash menu (which runs outside React) can
  // reach the dialog.
  useEffect(() => {
    const opener = () => {
      setUrl("");
      setOpen(true);
    };
    activeOpener = opener;
    return () => {
      if (activeOpener === opener) activeOpener = null;
    };
  }, []);

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
