import { Input } from "@repo/ui";

export function Default() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
      <Input placeholder="Search your vault…" />
      <Input defaultValue="Q3 Launch Plan" />
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
      <Input defaultValue="Archive/2024-retro.md" disabled />
      <Input defaultValue="Untitled note.md" aria-invalid />
    </div>
  );
}

export function Types() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
      <Input type="search" placeholder="Filter notes by title or tag" />
      <Input type="text" defaultValue="#projects/q3-launch" />
    </div>
  );
}
