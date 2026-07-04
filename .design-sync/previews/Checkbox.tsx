import { Checkbox } from "@repo/ui";

export function States() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Checkbox />
      <Checkbox defaultChecked />
      <Checkbox disabled />
      <Checkbox defaultChecked disabled />
    </div>
  );
}

export function TaskList() {
  const row = { display: "flex", gap: 8, alignItems: "center", fontSize: 13 } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={row}>
        <Checkbox defaultChecked />
        Summarize research notes
      </label>
      <label style={row}>
        <Checkbox />
        Draft the launch email
      </label>
      <label style={row}>
        <Checkbox />
        Review backlinks in Q3 Launch
      </label>
    </div>
  );
}

export function Invalid() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Checkbox aria-invalid />
      <Checkbox aria-invalid defaultChecked />
    </div>
  );
}
