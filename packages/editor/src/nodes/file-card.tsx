// An embed of a library file that is not an image (a PDF, a video, a sound, any other file) is
// the item's original, not a broken picture: it draws as a card naming the file, and Open hands
// its bytes to the system's viewer. Only a kind the browser shows itself is opened that way: a
// blob URL runs in the page's own origin, so a type that could run script never gets one.

import {
  FileArchiveIcon,
  FileIcon,
  FileTextIcon,
  FilmIcon,
  ImageIcon,
  MusicIcon,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";

import { getEditorHostIo } from "@repo/editor/host-io";
import { fileKindOf } from "@repo/notes/items/item-kind";
import type { FileKind } from "@repo/notes/items/item-kind";
import { basenamePath } from "@repo/notes/knowledge/vault-path";

// the glyph a file's kind is drawn with; a doc, which is no file kind, gets the plain one
export const FileKindIcon = ({ path, ...props }: { path: string } & LucideProps) => {
  const kind: FileKind | null = fileKindOf(path);
  switch (kind) {
    case "audio": {
      return <MusicIcon {...props} />;
    }
    case "file": {
      return <FileArchiveIcon {...props} />;
    }
    case "image": {
      return <ImageIcon {...props} />;
    }
    case "pdf": {
      return <FileTextIcon {...props} />;
    }
    case "video": {
      return <FilmIcon {...props} />;
    }
    case null: {
      return <FileIcon {...props} />;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
};

// what the system viewer may be handed as a blob of the page's own origin
const OPENABLE_TYPE = /^(?:application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+)$/u;

// a viewer that never asks for the bytes again still gets a minute before the URL goes
const OPEN_URL_LIFETIME_MS = 60_000;

const openInViewer = async (path: string): Promise<void> => {
  const result = await getEditorHostIo()
    .readVaultAsset({ path })
    .catch(() => null);
  if (result === null || !result.ok || !OPENABLE_TYPE.test(result.bytes.type)) {
    toast.error(`${basenamePath(path)} can't be shown here. Reveal it in Finder to open it.`);
    return;
  }
  const url = URL.createObjectURL(result.bytes);
  window.open(url, "_blank", "noopener");
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OPEN_URL_LIFETIME_MS);
};

// `path` null: the embed names a file the library does not hold
export const FileCard = ({
  path,
  url,
  selected,
}: {
  path: string | null;
  url: string;
  selected: boolean;
}) => {
  const name = basenamePath(path ?? url);
  return (
    <div
      data-file-card=""
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2",
        selected && "ring-2 ring-ring ring-offset-2",
      )}
    >
      <FileKindIcon path={path ?? url} className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-subtitle">{name === "" ? "File" : name}</p>
        {path === null ? (
          <p className="m-0 truncate text-body text-muted-foreground">Not in your library</p>
        ) : null}
      </div>
      {path === null ? null : (
        <Button
          variant="secondary"
          size="compact"
          onClick={() => {
            const io = getEditorHostIo();
            if (io.opensFiles) {
              io.vault.openFile(path);
              return;
            }
            void openInViewer(path);
          }}
        >
          Open
        </Button>
      )}
    </div>
  );
};
