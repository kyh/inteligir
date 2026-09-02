// `.dark` is lifted around the synchronous print dialog (dark ink on white paper is near-invisible),
// and `document.title` becomes the note title because it is the browser's suggested PDF filename.

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
