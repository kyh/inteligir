import {
  Archive as FileArchiveIcon,
  File01 as FileIcon,
  File04 as FileTextIcon,
  Film01 as FilmIcon,
  Image01 as ImageIcon,
  MusicNote01 as MusicIcon,
} from "@untitledui/icons";
import type { IconProps } from "@repo/ui/lib/icon";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { cn } from "@repo/ui/lib/cn";
import { saveBlob } from "@repo/ui/lib/save-blob";

import { getEditorHostIo } from "@repo/editor/host-io";
import { fileKindOf } from "@repo/contract/items/item-kind";
import type { FileKind } from "@repo/contract/items/item-kind";

export const FileKindIcon = ({ name, ...props }: { name: string } & IconProps) => {
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

const download = async (readFile: (sha: string) => Promise<Blob>, sha: string, name: string) => {
  try {
    saveBlob(await readFile(sha), name);
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
}) => {
  const { readFile } = getEditorHostIo();

  return (
    <div
      data-file-card=""
      className={cn(
        "flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2",
        selected && "ring-2 ring-ring ring-offset-2",
      )}
    >
      <FileKindIcon name={name} className="size-4 shrink-0 text-muted-foreground" />
      <p className="m-0 min-w-0 flex-1 truncate text-subtitle">{name}</p>
      {readFile === null ? null : (
        <Button
          variant="secondary"
          size="compact"
          onClick={() => {
            void download(readFile, sha, name);
          }}
        >
          Download
        </Button>
      )}
    </div>
  );
};
