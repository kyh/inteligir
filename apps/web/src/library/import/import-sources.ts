export const IMPORT_SOURCES = ["raindrop", "bookmarks", "markdown"] as const;

export type ImportSource = (typeof IMPORT_SOURCES)[number];

interface ImportPick {
  readonly accept: string;
  readonly label: string;
}

export const IMPORT_PICKS: Readonly<Record<ImportSource, ImportPick>> = {
  bookmarks: { accept: ".html,.htm,text/html", label: "Import browser bookmarks…" },
  markdown: { accept: ".zip,application/zip", label: "Import a zip of notes…" },
  raindrop: { accept: ".csv,text/csv", label: "Import from Raindrop…" },
};
