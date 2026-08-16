import { useCallback, useEffect, useState } from "react";
import { cn } from "@repo/ui/lib/utils";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/native-select";
import { Switch } from "@repo/ui/components/switch";
import { Textarea } from "@repo/ui/components/textarea";

import { getBridge } from "@repo/bridge/client";
import type {
  ListRoutinesResult,
  Routine,
  RoutineSchedule,
  RoutineTarget,
} from "@repo/bridge/routines";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatSchedule(schedule: RoutineSchedule): string {
  switch (schedule.cadence) {
    case "daily":
      return `Daily at ${schedule.timeOfDay}`;
    case "weekly":
      return `Weekly on ${DAY_NAMES[schedule.dayOfWeek] ?? "?"} at ${schedule.timeOfDay}`;
    case "monthly":
      return `Monthly on day ${schedule.dayOfMonth} at ${schedule.timeOfDay}`;
  }
}

function formatTarget(target: RoutineTarget): string {
  return target.kind === "daily" ? "today's daily note" : target.path;
}

function formatLastRun(routine: Routine): string | null {
  const lastRun = routine.lastRun;
  if (lastRun === null) return null;
  const when = new Date(lastRun.finishedAt).toLocaleString();
  return lastRun.status === "done"
    ? `Last ran ${when} → ${lastRun.path}`
    : `Failed ${when} — ${lastRun.error}`;
}

/** The edit form's flat working state; folded into the discriminated
 * schedule/target unions only at save. */
type Draft = {
  id: string | null;
  name: string;
  prompt: string;
  cadence: RoutineSchedule["cadence"];
  timeOfDay: string;
  dayOfWeek: number;
  dayOfMonth: number;
  targetKind: RoutineTarget["kind"];
  targetPath: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  prompt: "",
  cadence: "daily",
  timeOfDay: "09:00",
  dayOfWeek: 1,
  dayOfMonth: 1,
  targetKind: "daily",
  targetPath: "",
  enabled: true,
};

function draftFrom(routine: Routine): Draft {
  return {
    id: routine.id,
    name: routine.name,
    prompt: routine.prompt,
    cadence: routine.schedule.cadence,
    timeOfDay: routine.schedule.timeOfDay,
    dayOfWeek: routine.schedule.cadence === "weekly" ? routine.schedule.dayOfWeek : 1,
    dayOfMonth: routine.schedule.cadence === "monthly" ? routine.schedule.dayOfMonth : 1,
    targetKind: routine.target.kind,
    targetPath: routine.target.kind === "note" ? routine.target.path : "",
    enabled: routine.enabled,
  };
}

function scheduleFrom(draft: Draft): RoutineSchedule {
  switch (draft.cadence) {
    case "daily":
      return { cadence: "daily", timeOfDay: draft.timeOfDay };
    case "weekly":
      return { cadence: "weekly", timeOfDay: draft.timeOfDay, dayOfWeek: draft.dayOfWeek };
    case "monthly":
      return { cadence: "monthly", timeOfDay: draft.timeOfDay, dayOfMonth: draft.dayOfMonth };
  }
}

function isCadence(value: string): value is RoutineSchedule["cadence"] {
  return value === "daily" || value === "weekly" || value === "monthly";
}

// Scheduled agent routines — delegation's sibling: the background agent runs
// the prompt on a cadence and the HOST appends its reply to the target note.
// This section is the whole V1 surface (a routines/*.md vault convention is a
// deferred follow-up): list, add/edit, enable, Run now, restore the last run.
export function RoutinesSection() {
  const [state, setState] = useState<ListRoutinesResult | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    void bridge
      .listRoutines()
      .then(setState)
      .catch(() => {});
    return bridge.onRoutinesUpdated(setState);
  }, []);

  const handleSave = useCallback(async () => {
    if (draft === null) return;
    setError(null);
    if (draft.name.trim() === "" || draft.prompt.trim() === "") {
      setError("Name and prompt are required.");
      return;
    }
    if (draft.targetKind === "note" && draft.targetPath.trim() === "") {
      setError("Pick a target note path (or target the daily note).");
      return;
    }
    const target: RoutineTarget =
      draft.targetKind === "daily"
        ? { kind: "daily" }
        : { kind: "note", path: draft.targetPath.trim() };
    setBusy(true);
    try {
      const result = await getBridge().upsertRoutine({
        ...(draft.id === null ? {} : { id: draft.id }),
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        schedule: scheduleFrom(draft),
        target,
        enabled: draft.enabled,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const handleToggleEnabled = useCallback(async (routine: Routine) => {
    setError(null);
    const result = await getBridge().upsertRoutine({
      id: routine.id,
      name: routine.name,
      prompt: routine.prompt,
      schedule: routine.schedule,
      target: routine.target,
      enabled: !routine.enabled,
    });
    if (!result.ok) setError(result.error);
  }, []);

  const handleRunNow = useCallback(async (id: string) => {
    setError(null);
    const result = await getBridge().runRoutineNow(id);
    if (!result.ok) setError(result.error);
  }, []);

  const handleDelete = useCallback(async (routine: Routine) => {
    const confirmed = await confirm({
      title: "Delete this routine?",
      body: `“${routine.name}” will stop running. Notes it already wrote are not touched.`,
      confirmLabel: "Delete routine",
      destructive: true,
    });
    if (!confirmed) return;
    setError(null);
    await getBridge().deleteRoutine(routine.id);
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    setError(null);
    const result = await getBridge().restoreRoutineRun(id);
    if (!result.ok) setError(result.error);
  }, []);

  const routines = state?.routines ?? [];
  const runningId = state?.runningId ?? null;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Routines</Label>
      <div className="flex flex-col gap-2 rounded-[12px] bg-muted px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          Scheduled agent tasks — the agent runs the prompt on a cadence and appends its result to
          the target note. Runs share the background agent with delegated tasks (one at a time) and
          are snapshotted before they write, so Restore undoes the last run.
        </p>

        {error !== null && (
          <p className="rounded-[8px] bg-card px-2.5 py-1.5 text-[10px] text-destructive">
            {error}
          </p>
        )}

        {routines.map((routine) => (
          <div key={routine.id} className="flex flex-col gap-1 rounded-[8px] bg-card px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-xs text-foreground">{routine.name}</span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {formatSchedule(routine.schedule)} → {formatTarget(routine.target)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Switch
                  size="sm"
                  checked={routine.enabled}
                  onCheckedChange={() => void handleToggleEnabled(routine)}
                  aria-label={`Enable ${routine.name}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRunNow(routine.id)}
                  disabled={runningId !== null}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {runningId === routine.id ? "Running…" : "Run now"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setDraft(draftFrom(routine));
                  }}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(routine)}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  Delete
                </Button>
              </span>
            </div>
            {formatLastRun(routine) !== null && (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-muted-foreground">
                  {formatLastRun(routine)}
                </span>
                {routine.lastRun?.hasSnapshot === true && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRestore(routine.id)}
                    disabled={runningId === routine.id}
                    className="h-auto shrink-0 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {routine.lastRun.restoredAt === null ? "Restore" : "Restored"}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Stays MOUNTED while the form is open, hidden by class: a
            button that unmounts itself on click detaches the press target
            before Base UI's outside-press check resolves, and the whole
            Settings dialog closes. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setError(null);
            setDraft(EMPTY_DRAFT);
          }}
          className={cn(
            "h-auto self-start px-2 py-0.5 text-[10px] text-muted-foreground",
            draft !== null && "hidden",
          )}
        >
          Add routine…
        </Button>
        {draft !== null && (
          <div className="flex flex-col gap-2 rounded-[8px] bg-card px-2.5 py-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Morning briefing"
                className="h-7 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-muted-foreground">Prompt</span>
              <Textarea
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder="Summarize yesterday's notes and list today's open tasks."
                className="min-h-16 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Cadence</span>
                <NativeSelect
                  size="sm"
                  value={draft.cadence}
                  onChange={(e) => {
                    const { value } = e.target;
                    if (isCadence(value)) setDraft({ ...draft, cadence: value });
                  }}
                >
                  <NativeSelectOption value="daily">Daily</NativeSelectOption>
                  <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
                  <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
                </NativeSelect>
              </div>
              {draft.cadence === "weekly" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Day</span>
                  <NativeSelect
                    size="sm"
                    value={String(draft.dayOfWeek)}
                    onChange={(e) => setDraft({ ...draft, dayOfWeek: Number(e.target.value) })}
                  >
                    {DAY_NAMES.map((name, day) => (
                      <NativeSelectOption key={name} value={String(day)}>
                        {name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}
              {draft.cadence === "monthly" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Day (1–28)</span>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={draft.dayOfMonth}
                    onChange={(e) => {
                      const day = Math.min(28, Math.max(1, Math.trunc(Number(e.target.value))));
                      setDraft({ ...draft, dayOfMonth: Number.isNaN(day) ? 1 : day });
                    }}
                    className="h-7 w-16 text-xs"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Time</span>
                <Input
                  type="time"
                  value={draft.timeOfDay}
                  onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value })}
                  className="h-7 w-24 text-xs"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Write result to</span>
                <NativeSelect
                  size="sm"
                  value={draft.targetKind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      targetKind: e.target.value === "note" ? "note" : "daily",
                    })
                  }
                >
                  <NativeSelectOption value="daily">Today's daily note</NativeSelectOption>
                  <NativeSelectOption value="note">A specific note</NativeSelectOption>
                </NativeSelect>
              </div>
              {draft.targetKind === "note" && (
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Note path</span>
                  <Input
                    value={draft.targetPath}
                    onChange={(e) => setDraft({ ...draft, targetPath: e.target.value })}
                    placeholder="reviews/weekly.md"
                    className="h-7 text-xs"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Switch
                  size="sm"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
                />
                Enabled
              </label>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setDraft(null);
                  }}
                  className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={busy}
                  className="h-auto px-2 py-0.5 text-[10px] text-foreground"
                >
                  {draft.id === null ? "Add routine" : "Save"}
                </Button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
