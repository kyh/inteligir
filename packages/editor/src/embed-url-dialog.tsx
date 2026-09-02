// The slash combobox unmounts itself on selection, so the item cannot host UI;
// it calls the module-level opener instead.

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

import { insertEmbedFromUrl } from "@repo/editor/kits/embed-kit";

let activeOpener: (() => void) | null = null;

export function openEmbedUrlDialog(): void {
  activeOpener?.();
}

export function EmbedUrlDialogHost() {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

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
          <Button variant="primary" size="compact" onClick={submit} disabled={!trimmed}>
            Embed
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
