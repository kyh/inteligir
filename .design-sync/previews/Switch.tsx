import { Switch } from "@repo/ui";

const noop = () => {};

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Switch label="Ghost-text completions" checked onToggle={noop} />
      <Switch label="Infer note properties" checked={false} onToggle={noop} />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Switch label="Sync to cloud (Pro)" checked={false} onToggle={noop} disabled />
      <Switch label="Read-only vault" checked onToggle={noop} disabled />
    </div>
  );
}
