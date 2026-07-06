import { Label, Input, Checkbox } from "@repo/ui";

export function FieldLabel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
      <Label htmlFor="note-title">Note title</Label>
      <Input id="note-title" defaultValue="Q3 Launch Plan" />
    </div>
  );
}

export function VaultField() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 320 }}>
      <Label htmlFor="vault-path">Vault folder</Label>
      <Input id="vault-path" placeholder="~/Documents/Vault" />
    </div>
  );
}

export function TaskRow() {
  return (
    <Label htmlFor="delegate-task">
      <Checkbox id="delegate-task" defaultChecked />
      Delegate: summarize research notes
    </Label>
  );
}
