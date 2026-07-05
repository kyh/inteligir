import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  Button,
} from "@repo/ui";

export function ShareNote() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="secondary">Share note</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share "Q3 Research Notes"</DialogTitle>
          <DialogDescription>
            Invite collaborators to read or edit this note. Links are scoped to your vault.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            readOnly
            value="inteligir.app/n/q3-research-notes"
            style={{
              flex: 1,
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "inherit",
              fontSize: 13,
            }}
          />
          <Button variant="secondary" size="sm">
            Copy link
          </Button>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button variant="primary">Invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditProperties() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="secondary">Properties</Button>} />
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Note properties</DialogTitle>
          <DialogDescription>
            Frontmatter written to the top of the markdown file on disk.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <span style={{ color: "var(--muted-foreground)" }}>Title</span>
            <input
              defaultValue="Q3 Research Notes"
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "inherit",
                fontSize: 13,
              }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            <span style={{ color: "var(--muted-foreground)" }}>Tags</span>
            <input
              defaultValue="research, planning, q3"
              style={{
                height: 32,
                padding: "0 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "inherit",
                fontSize: 13,
              }}
            />
          </label>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Discard</Button>} />
          <Button variant="primary">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClosedTrigger() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary">Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New vault</DialogTitle>
          <DialogDescription>Pick a folder of markdown to open as a vault.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button variant="primary">Choose folder</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
