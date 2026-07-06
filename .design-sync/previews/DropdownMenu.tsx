import {
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownSeparator,
  MenuItem,
  Button,
} from "@repo/ui";
import { Pencil, Copy, Sparkles, Trash2, ArrowUpRight } from "lucide-react";

export function NoteActions() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownTrigger render={<Button variant="secondary">Actions</Button>} />
      <DropdownContent>
        <MenuItem index={0} icon={Pencil} label="Rename" onSelect={() => {}} />
        <MenuItem index={1} icon={Copy} label="Duplicate" onSelect={() => {}} />
        <MenuItem index={2} icon={ArrowUpRight} label="Move to…" onSelect={() => {}} />
        <MenuItem
          index={3}
          icon={Sparkles}
          label="Delegate to agent"
          shortcut="⌘J"
          onSelect={() => {}}
        />
        <DropdownSeparator />
        <MenuItem index={4} icon={Trash2} label="Delete note" destructive onSelect={() => {}} />
      </DropdownContent>
    </DropdownMenu>
  );
}
