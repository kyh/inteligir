import { ScrollArea } from "@repo/ui";

const notes = [
  "Launch checklist",
  "Weekly sync",
  "Q3 roadmap",
  "Reading list",
  "Meeting notes 08-19",
  "Vault conventions",
  "Interview prep",
  "Release retro",
  "Ideas inbox",
  "Daily 2026-08-22",
];

export function NoteList() {
  return (
    <ScrollArea style={{ height: 180, width: 260 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
        {notes.map((title) => (
          <div key={title} style={{ padding: "6px 8px", fontSize: 13 }}>
            {title}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
