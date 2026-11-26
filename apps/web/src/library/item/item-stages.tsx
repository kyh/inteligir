import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { Button } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/cn";
import { toast } from "@repo/ui/components/sonner";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";

import { usePageLibrary } from "../cloud/library-context";
import { fileUrl, readFile } from "../cloud/library-files";
import { saveBlob } from "@repo/ui/lib/save-blob";
import { readingNotice } from "../library/item-labels";

const SaveFile = ({ sha, name, label }: { sha: string; name: string; label: string }) => {
  const { cloud } = usePageLibrary();

  const save = useMutation({
    mutationFn: async () => {
      saveBlob(await readFile(cloud, sha), name);
    },
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

const PdfObject = ({
  className,
  fields,
  sha,
  title,
}: {
  className: string;
  fields: LibraryItemFields;
  sha: string;
  title: string;
}) => (
  <object
    aria-label={title}
    data={fileUrl(sha, fields.originalName)}
    type="application/pdf"
    className={cn("w-full rounded-md border border-border", className)}
  >
    <SaveFile
      sha={sha}
      name={fields.originalName ?? title}
      label={`Download ${fields.originalName ?? "the PDF"}`}
    />
  </object>
);

export const FilePane = ({ fields, title }: { fields: LibraryItemFields; title: string }) =>
  fields.originalSha === null ? null : (
    <div className="flex h-[45vh] shrink-0 justify-center border-b border-border p-3 lg:h-auto lg:w-1/2 lg:border-r lg:border-b-0">
      {fields.kind === "pdf" ? (
        <PdfObject fields={fields} sha={fields.originalSha} title={title} className="h-full" />
      ) : (
        <img
          alt={title}
          src={fileUrl(fields.originalSha, fields.originalName)}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      )}
    </div>
  );

export const FileStage = ({ fields, title }: { fields: LibraryItemFields; title: string }) => {
  const sha = fields.originalSha;

  if (sha === null) {
    return null;
  }

  const url = fileUrl(sha, fields.originalName);

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
          <PdfObject fields={fields} sha={sha} title={title} className="h-[70vh]" />
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
    case "folder":
    case "link":
    case "list":
    case "note": {
      return (
        <div className="px-8 pt-4">
          <SaveFile
            sha={sha}
            name={fields.originalName ?? title}
            label={`Download ${fields.originalName ?? "the file"}`}
          />
        </div>
      );
    }

    default: {
      throw new Error(`unexpected ${String(fields.kind satisfies never)}`);
    }
  }
};

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

export const ReadingNotice = ({ fields }: { fields: LibraryItemFields }) => {
  const { reading } = fields;
  const notice = readingNotice(reading);

  return notice === null ? null : (
    <p className="m-0 px-8 pt-3 text-body text-muted-foreground" data-reading={reading.state}>
      {notice}
    </p>
  );
};
