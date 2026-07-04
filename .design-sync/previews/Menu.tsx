import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuGroup,
  MenuGroupLabel,
  MenuSeparator,
  MenuSub,
  MenuSubTrigger,
  MenuSubContent,
  Button,
} from "@repo/ui";
import { Pencil, Copy, Sparkles, Trash2, FolderInput } from "lucide-react";

export function NoteActions() {
  return (
    <Menu defaultOpen>
      <MenuTrigger
        render={
          <Button variant="secondary" size="sm">
            Note actions
          </Button>
        }
      />
      <MenuContent align="start" sideOffset={6}>
        <MenuItem>
          <Pencil />
          Rename
        </MenuItem>
        <MenuItem>
          <Copy />
          Duplicate
        </MenuItem>
        <MenuItem>
          <Sparkles />
          Delegate to agent
        </MenuItem>
        <MenuSeparator />
        <MenuItem>
          <Trash2 />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function WithSubmenu() {
  return (
    <Menu defaultOpen>
      <MenuTrigger
        render={
          <Button variant="secondary" size="sm">
            Organize
          </Button>
        }
      />
      <MenuContent align="start" sideOffset={6}>
        <MenuGroup>
          <MenuGroupLabel>This note</MenuGroupLabel>
          <MenuItem>
            <Pencil />
            Rename
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger>
              <FolderInput />
              Move to
            </MenuSubTrigger>
            <MenuSubContent>
              <MenuItem>Research</MenuItem>
              <MenuItem>Planning</MenuItem>
              <MenuItem>Archive</MenuItem>
            </MenuSubContent>
          </MenuSub>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem>
          <Trash2 />
          Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
