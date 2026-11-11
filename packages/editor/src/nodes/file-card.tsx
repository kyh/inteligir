// A file a note embeds that no picture or player draws (a PDF, a sound, a document, any other
// file) is a card naming it, its glyph read from its name. Where the host can hand a file on
// (`savesFiles`), its Download reads the bytes from where the host draws its files and saves them
// under that name; the page itself never opens one, since a blob of its own origin is a page that
// could run script.

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
import { saveBlob } from "@repo/ui/lib/save-blob";

import { getEditorHostIo } from "@repo/editor/host-io";
import { fileKindOf } from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";

// the glyph a file's kind is drawn with; a name of no known kind gets the plain one
export const FileKindIcon = ({ name, ...props }: { name: string } & LucideProps) => {
  const kind: FileKind | null = fileKindOf(name);
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

const download = async (sha: string, name: string): Promise<void> => {
  try {
    saveBlob(await getEditorHostIo().readFile(sha), name);
  } catch {
    toast.error(`${name} isn't on this device yet. Try again once you're online.`);
  }
};

export const FileCard = ({
  sha,
  name,
  selected,
}: {
  sha: string;
  name: string;
  selected: boolean;
}) => (
  <div
    data-file-card=""
    className={cn(
      "flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2",
      selected && "ring-2 ring-ring ring-offset-2",
    )}
  >
    <FileKindIcon name={name} className="size-4 shrink-0 text-muted-foreground" />
    <p className="m-0 min-w-0 flex-1 truncate text-subtitle">{name}</p>
    {getEditorHostIo().savesFiles ? (
      <Button
        variant="secondary"
        size="compact"
        onClick={() => {
          void download(sha, name);
        }}
      >
        Download
      </Button>
    ) : null}
  </div>
);
