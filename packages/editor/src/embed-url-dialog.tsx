// The Embed row's url prompt, open by an option of the editor whose row ran: the slash combobox
// unmounts itself on a pick, so the prompt is drawn after the editable instead.

import { useState } from "react";
import type { PluginConfig } from "platejs";
import { createTPlatePlugin, useEditorRef, usePluginOption } from "platejs/react";

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

const EmbedPromptOptions = createTPlatePlugin<PluginConfig<"embedPrompt", { open: boolean }>>({
  key: "embedPrompt",
  options: { open: false },
});

// mounted only while the prompt is open, so each opening starts empty
const EmbedUrlForm = () => {
  const editor = useEditorRef();
  const [url, setUrl] = useState("");
  const [refused, setRefused] = useState(false);
  const trimmed = url.trim();

  const submit = () => {
    if (!trimmed) {
      return;
    }
    if (!insertEmbedFromUrl(editor, trimmed)) {
      setRefused(true);
      return;
    }
    editor.setOption(EmbedPromptOptions, "open", false);
    editor.tf.focus();
  };

  return (
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
  );
};

const EmbedPrompt = () => {
  const editor = useEditorRef();
  const open = usePluginOption(EmbedPromptOptions, "open");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        editor.setOption(EmbedPromptOptions, "open", next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed from URL</DialogTitle>
          <DialogDescription>
            A video, tweet, PDF or page. Your library loads nothing from the web, so it shows as a
            card that opens in your browser.
          </DialogDescription>
        </DialogHeader>
        <EmbedUrlForm />
      </DialogContent>
    </Dialog>
  );
};

export const EmbedPromptPlugin = EmbedPromptOptions.extend({
  render: { afterEditable: EmbedPrompt },
});
