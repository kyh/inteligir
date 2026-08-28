// PDF export is the browser's own print pipeline over a print stylesheet
// (styles/print.css + the editor's print: classes) — no renderer, no deps,
// nothing the prod CSP has to admit. The document prints light regardless of
// theme: dark ink tokens on white paper would be near-invisible, so the
// `.dark` class is lifted for the (synchronous) print dialog and restored
// after, and `document.title` briefly becomes the note title because it is
// the browser's suggested PDF filename.

export function exportNoteAsPdf(title: string): void {
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  const previousTitle = document.title;
  if (title.trim() !== "") {
    document.title = title;
  }
  root.classList.remove("dark");
  try {
    window.print();
  } finally {
    if (wasDark) {
      root.classList.add("dark");
    }
    document.title = previousTitle;
  }
}
