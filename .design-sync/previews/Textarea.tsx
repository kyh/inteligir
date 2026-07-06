import { Textarea } from "@repo/ui";

export function Default() {
  return (
    <div style={{ maxWidth: 380 }}>
      <Textarea placeholder="Add a note, or ask the agent to draft one…" rows={3} />
    </div>
  );
}

export function Filled() {
  return (
    <div style={{ maxWidth: 380 }}>
      <Textarea
        rows={4}
        defaultValue={
          "## Meeting notes\n\n- [ ] Summarize decisions\n- [ ] File under Projects/Q3 Launch"
        }
      />
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 380 }}>
      <Textarea disabled rows={2} defaultValue="Read-only — synced from ./vault" />
      <Textarea aria-invalid rows={2} defaultValue="Frontmatter failed to parse" />
    </div>
  );
}
