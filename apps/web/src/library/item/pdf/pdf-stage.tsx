import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PencilIcon, Undo2Icon } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useState } from "react";

import { useLibraryWrites, usePageLibrary } from "../../cloud/library-context";
import { readFile } from "../../cloud/library-files";
import { newId } from "../../cloud/new-id";
import { SaveFile } from "../save-file";
import { loadPdf } from "./pdf-document";
import { PdfPage } from "./pdf-page";
import type { LineEdit } from "./pdf-page";
import type { TextEdit } from "./text-edits";

const PAGE_GAP = 12;
const MAX_WIDTH = 880;

type Opened =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly doc: PDFDocumentProxy; readonly kind: "open" };

const useOpened = (bytes: Uint8Array | undefined) => {
  const [opened, setOpened] = useState<Opened>({ kind: "loading" });

  useEffect(() => {
    if (bytes === undefined) {
      return;
    }

    let live = true;
    const loading = loadPdf(bytes);

    const open = async () => {
      try {
        const doc = await loading.document;

        if (live) {
          setOpened({ doc, kind: "open" });
        }
      } catch {
        if (live) {
          setOpened({ kind: "failed" });
        }
      }
    };

    void open();

    return () => {
      live = false;
      loading.stop();
    };
  }, [bytes]);

  return opened;
};

const useWidth = (frame: HTMLElement | null) => {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (frame === null) {
      return;
    }

    const measure = () => {
      setWidth(Math.min(MAX_WIDTH, frame.clientWidth - PAGE_GAP * 2));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, [frame]);

  return width;
};

const textEditOf = ({ background, color, line, page, text }: LineEdit) =>
  ({
    background,
    box: line.box,
    color,
    page,
    size: line.size,
    text,
    x: line.x,
    y: line.y,
  }) satisfies TextEdit;

const warmFonts = () => {
  void import("./system-fonts").then(async ({ tabFonts }) => await tabFonts.warm());
};

export const PdfStage = ({
  fields,
  itemId,
  sha,
  title,
}: {
  fields: LibraryItemFields;
  itemId: string;
  sha: string;
  title: string;
}) => {
  const { cloud } = usePageLibrary();
  const writes = useLibraryWrites();
  const save = useMutation(writes.saveEditedPdf());
  const revert = useMutation(writes.revertPdf());
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const width = useWidth(frame);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ReadonlyMap<string, LineEdit>>(new Map());

  const file = useQuery({
    queryFn: async () => {
      const blob = await readFile(cloud, sha);

      return new Uint8Array(await blob.arrayBuffer());
    },
    queryKey: ["library-file", sha],
    staleTime: Number.POSITIVE_INFINITY,
  });

  const opened = useOpened(file.data);
  const busy = save.isPending || revert.isPending;

  const stopEditing = async () => {
    const sure =
      edits.size === 0 ||
      (await confirm({
        body: "The lines you changed go back to what they said.",
        cancelLabel: "Keep editing",
        confirmLabel: "Discard changes",
        destructive: true,
        title: "Discard your changes to this PDF?",
      }));

    if (sure) {
      setEdits(new Map());
      setEditing(false);
    }
  };

  const unreadable = file.isError || opened.kind === "failed";

  return (
    <section
      aria-label={title}
      className="mx-8 mt-4 overflow-hidden rounded-md border border-border"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2">
        {editing ? (
          <>
            <span className="mr-auto text-caption text-muted-foreground">
              {edits.size === 0
                ? "Click a line to change its words."
                : `${String(edits.size)} ${edits.size === 1 ? "line" : "lines"} changed.`}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void stopEditing();
              }}
            >
              Discard
            </Button>
            <Button
              disabled={busy || edits.size === 0 || file.data === undefined}
              onClick={() => {
                if (file.data === undefined) {
                  return;
                }

                warmFonts();
                save.mutate({
                  bytes: file.data,
                  edits: [...edits.values()].map(textEditOf),
                  id: itemId,
                });
              }}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              disabled={opened.kind !== "open" || busy}
              onClick={() => {
                setEditing(true);
              }}
            >
              <PencilIcon />
              Edit text
            </Button>
            <span className="mr-auto" />
            <SaveFile
              variant="ghost"
              sha={sha}
              name={fields.originalName ?? `${title}.pdf`}
              label={fields.editedSha === null ? "Download" : "Download edited PDF"}
            />
            {fields.editedSha === null ? null : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const sure = await confirm({
                      body: "Every change you saved to its text goes away.",
                      confirmLabel: "Go back to the original",
                      destructive: true,
                      title: "Go back to the original PDF?",
                    });

                    if (sure) {
                      revert.mutate({ id: itemId, opId: newId(), sha: null });
                    }
                  })();
                }}
              >
                <Undo2Icon />
                Revert to the original
              </Button>
            )}
          </>
        )}
      </div>
      <div
        ref={setFrame}
        className="flex h-[75vh] flex-col items-center overflow-y-auto bg-muted/40 py-3"
        style={{ gap: PAGE_GAP }}
      >
        {unreadable ? (
          <p className="m-auto px-6 text-center text-body text-muted-foreground">
            This PDF couldn’t be shown here. Download it to read it.
          </p>
        ) : null}
        {opened.kind === "open" && width > 0
          ? Array.from({ length: opened.doc.numPages }, (_, index) => (
              <PdfPage
                key={index}
                doc={opened.doc}
                editing={editing && !save.isPending}
                edits={edits}
                index={index}
                width={width}
                onEdit={(key, edit) => {
                  const next = new Map(edits);

                  if (edit === null) {
                    next.delete(key);
                  } else {
                    next.set(key, edit);
                  }

                  setEdits(next);
                }}
              />
            ))
          : null}
      </div>
    </section>
  );
};
