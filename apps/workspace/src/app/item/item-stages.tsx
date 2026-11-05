// What an item that is a file shows above its note: the image, the PDF, the recording or a way to
// download the file, from the library's files where the page's host draws them (the cloud's own
// route under the tab's cookie, or the Mac shell's scheme); and
// what a saved page shows before its text arrives.

import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { useFileUrl } from "../cloud/library-context";
import { saveBlob } from "../save-file";

// The file's bytes read where the host draws them, then saved under its own name: the Mac's
// scheme is another origin than its page, where a `download` link would be followed instead
// (save-file.ts). It reads what the device holds, so it runs with no connection too.
const SaveFile = ({ url, name, label }: { url: string; name: string; label: string }) => {
  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(url);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`the file answered ${String(response.status)}`);
      }
      saveBlob(await response.blob(), name);
    },
    // a file the device holds saves offline; one it would fetch fails at once and says so
    networkMode: "always",
    onError: () => {
      toast.error("The file couldn't be saved. Check your connection and try again.");
    },
  });
  return (
    <Button
      variant="secondary"
      disabled={save.isPending}
      onClick={() => {
        save.mutate();
      }}
    >
      <DownloadIcon />
      {label}
    </Button>
  );
};

export const FileStage = ({ fields, title }: { fields: LibraryItemFields; title: string }) => {
  const fileUrl = useFileUrl();
  const sha = fields.originalSha;
  if (sha === null) {
    return null;
  }
  const url = fileUrl(sha);
  switch (fields.kind) {
    case "image": {
      return (
        <div className="flex justify-center px-8 pt-4">
          <img
            alt={title}
            src={url}
            className="max-h-[70vh] max-w-full rounded-md object-contain"
          />
        </div>
      );
    }
    case "pdf": {
      return (
        <div className="px-8 pt-4">
          <object
            aria-label={title}
            data={url}
            type="application/pdf"
            className="h-[70vh] w-full rounded-md border border-border"
          >
            <SaveFile
              url={url}
              name={fields.originalName ?? title}
              label={`Download ${fields.originalName ?? "the PDF"}`}
            />
          </object>
        </div>
      );
    }
    case "video": {
      return (
        <div className="flex justify-center px-8 pt-4">
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a person's own recording has no caption track to offer */}
          <video controls src={url} className="max-h-[70vh] max-w-full rounded-md" />
        </div>
      );
    }
    case "audio": {
      return (
        <div className="px-8 pt-4">
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a person's own recording has no caption track to offer */}
          <audio controls src={url} className="w-full" />
        </div>
      );
    }
    case "file":
    case "link":
    case "note": {
      return (
        <div className="px-8 pt-4">
          <SaveFile
            url={url}
            name={fields.originalName ?? title}
            label={`Download ${fields.originalName ?? "the file"}`}
          />
        </div>
      );
    }
    // no default
  }
};

// where a saved page came from, above its text
export const SourceHeader = ({ fields }: { fields: LibraryItemFields }) => {
  const { url } = fields;
  if (url === null) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 px-8 pt-4 text-body text-muted-foreground">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 truncate underline-offset-2 hover:underline"
      >
        <span className="truncate">{fields.site ?? url}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0" />
      </a>
    </div>
  );
};

// a link saved but not read yet: the cloud reads it, and its text lands under the note
export const PendingNotice = ({ failed }: { failed: string | null }) => (
  <p className="m-0 px-8 pt-3 text-body text-muted-foreground" data-fetch-state="pending">
    {failed ?? "Not read yet. The page is read in the cloud, and its text appears here soon."}
  </p>
);
