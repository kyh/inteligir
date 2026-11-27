import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from "pdfjs-dist";

export const loadPdf = (bytes: Uint8Array) => {
  let task: PDFDocumentLoadingTask | null = null;
  let reader: PDFWorker | null = null;
  let port: Worker | null = null;
  let stopped = false;

  const document = (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    if (stopped) {
      throw new Error("the PDF was put away before it opened");
    }

    port = new Worker(new URL("pdf-worker.ts", import.meta.url), { type: "module" });
    reader = pdfjs.PDFWorker.create({ port });
    task = pdfjs.getDocument({ data: new Uint8Array(bytes), worker: reader });

    return await task.promise;
  })() satisfies Promise<PDFDocumentProxy>;

  return {
    document,
    stop: () => {
      stopped = true;
      void task?.destroy();
      reader?.destroy();
      port?.terminate();
    },
  };
};
