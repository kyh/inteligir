import "core-js/actual/map/get-or-insert-computed";
import "core-js/actual/math/sum-precise";
import "core-js/actual/promise/with-resolvers";
import "core-js/actual/typed-array/from-base64";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useEffect, useMemo, useState } from "react";
import { Document, pdfjs } from "react-pdf";

import { PdfPage } from "./pdf-page";
import type { LineEdit } from "./pdf-page";

export type PdfShown = "failed" | "open";

const readerOf = () => {
  const port = new Worker(new URL("pdf-worker.ts", import.meta.url), { type: "module" });

  return { options: { worker: pdfjs.PDFWorker.create({ port }) }, port };
};

export const PdfViewer = ({
  bytes,
  editing,
  edits,
  onEdit,
  onShown,
  width,
}: {
  bytes: Uint8Array;
  editing: boolean;
  edits: ReadonlyMap<string, LineEdit>;
  onEdit: (key: string, edit: LineEdit | null) => void;
  onShown: (shown: PdfShown) => void;
  width: number;
}) => {
  const file = useMemo(
    () => new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
    [bytes],
  );

  const reader = useMemo(() => readerOf(), []);
  const [pages, setPages] = useState(0);

  useEffect(
    () => () => {
      reader.options.worker.destroy();
      reader.port.terminate();
    },
    [reader],
  );

  return (
    <Document
      file={file}
      options={reader.options}
      loading={null}
      error={null}
      suspense={false}
      className="contents"
      onLoadSuccess={({ numPages }) => {
        setPages(numPages);
        onShown("open");
      }}
      onLoadError={() => {
        onShown("failed");
      }}
    >
      {width > 0
        ? Array.from({ length: pages }, (_, index) => (
            <PdfPage
              key={index}
              editing={editing}
              edits={edits}
              index={index}
              width={width}
              onEdit={onEdit}
            />
          ))
        : null}
    </Document>
  );
};
