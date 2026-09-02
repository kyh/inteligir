// Degrading never touches bytes: the fence value stays verbatim on the node; only the presentation changes.

import { useState, type ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";

export function RichBlockCard({
  actions,
  children,
  label,
}: {
  label: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      contentEditable={false}
      className="group/richblock relative my-2 rounded-md border border-border bg-muted/20"
    >
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
        <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase select-none">
          {label}
        </span>
        <span className="flex-1" />
        <span className="opacity-0 transition-opacity group-hover/richblock:opacity-100">
          {actions}
        </span>
      </div>
      {children}
    </div>
  );
}

export function DegradedPayloadView({ reason, value }: { reason: string; value: string }) {
  return (
    <div>
      <p className="px-2 pt-1 text-xs text-amber-600 dark:text-amber-500">{reason}</p>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs whitespace-pre text-muted-foreground">
        {value}
      </pre>
    </div>
  );
}

export function PayloadEditor({
  initial,
  onCancel,
  onSave,
  validate,
}: {
  initial: string;
  onCancel: () => void;
  validate: (value: string) => string | null;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="p-2">
      <textarea
        aria-label="Block payload"
        value={value}
        rows={Math.min(16, Math.max(4, value.split("\n").length + 1))}
        spellCheck={false}
        className={cn(
          "w-full resize-y rounded-md border bg-background p-2 font-mono text-xs",
          refusal === null ? "border-border" : "border-destructive",
        )}
        onChange={(event) => {
          setValue(event.target.value);
          setRefusal(null);
        }}
      />
      {refusal === null ? null : <p className="pt-1 text-xs text-destructive">{refusal}</p>}
      <div className="flex justify-end gap-2 pt-1.5">
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="rounded-md bg-primary px-2 py-0.5 text-xs text-primary-foreground"
          onClick={() => {
            const verdict = validate(value);
            if (verdict === null) {
              onSave(value);
            } else {
              setRefusal(verdict);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
