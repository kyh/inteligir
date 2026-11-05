// What an item that is a file shows above its note: the image, the PDF, the recording or a way to
// download the file, from the library's files (`/v1/blobs/<sha>`) under the page's own cookie; and
// what a saved page shows before its text arrives.

import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { Button } from "@repo/ui/components/button";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { blobUrl } from "../library/item-card";

export const FileStage = ({ fields, title }: { fields: LibraryItemFields; title: string }) => {
  const sha = fields.originalSha;
  if (sha === null) {
    return null;
  }
  const url = blobUrl(sha);
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
            <a href={url} download={fields.originalName ?? title}>
              Download {fields.originalName ?? "the PDF"}
            </a>
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
          <Button
            variant="secondary"

            render={
              <a
                href={url}
                download={fields.originalName ?? title}
                aria-label={`Download ${fields.originalName ?? "the file"}`}
              />
            }
          >
            <DownloadIcon />
            Download {fields.originalName ?? "the file"}
          </Button>
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
