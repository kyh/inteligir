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
import { isImeComposing } from "@repo/ui/lib/ime";

import { insertEmbedFromUrl } from "@repo/editor/kits/embed-kit";

let activeOpener: (() => void) | null = null;

export const openEmbedUrlDialog = (): void => {
  activeOpener?.();
};

export const EmbedUrlDialogHost = () => {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    const opener = () => {
      setUrl("");
      setRefused(false);
      setOpen(true);
    };
    activeOpener = opener;
    return () => {
      if (activeOpener === opener) {
        activeOpener = null;
      }
    };
  }, []);

  const trimmed = url.trim();

  const submit = () => {
    if (!trimmed) {
      return;
    }
    if (!insertEmbedFromUrl(editor, trimmed)) {
      setRefused(true);
      return;
    }
    setOpen(false);
    editor.tf.focus();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed from URL</DialogTitle>
          <DialogDescription>
            A video, tweet, PDF or page. Your library loads nothing from the web, so it shows as a
            card that opens in your browser.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            aria-invalid={refused}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setRefused(false);
            }}
            placeholder="https://…"
            onKeyDown={(e) => {
              if (isImeComposing(e)) {
                return;
              }
              if (e.key === "Enter") {
                submit();
              }
            }}
          />
          {refused ? (
            <p className="text-body text-destructive">
              Only a web link embeds. Paste one that starts with https://
            </p>
          ) : null}
          <Button variant="primary" size="compact" onClick={submit} disabled={!trimmed}>
            Embed
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
