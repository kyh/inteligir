import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";

import { formatSchedule, type CreateTaskParams, type TaskSchedule } from "@/shared/task";
import { useTaskStore } from "@/renderer/stores/task-store";

// ---------------------------------------------------------------------------
// Natural-language schedule presets — Chief-of-Staff scheduling speaks in
// English, not cron. Each preset resolves to a TaskSchedule at submit time;
// time-of-day presets honor the user's local timezone (croner runs in local
// time on the main process).
// ---------------------------------------------------------------------------

type Preset = {
  id: string;
  label: string;
  resolve: (timeOfDay: string) => TaskSchedule;
  needsTime: boolean;
};

const PRESETS: Preset[] = [
  {
    id: "weekdays",
    label: "Every weekday",
    needsTime: true,
    resolve: (t) => cronAt(t, "1-5"),
  },
  {
    id: "daily",
    label: "Every day",
    needsTime: true,
    resolve: (t) => cronAt(t, "*"),
  },
  {
    id: "mon-fri-9",
    label: "Mondays",
    needsTime: true,
    resolve: (t) => cronAt(t, "1"),
  },
  {
    id: "hourly",
    label: "Every hour",
    needsTime: false,
    resolve: () => ({ type: "interval", intervalMs: 60 * 60_000 }),
  },
  {
    id: "every-15-min",
    label: "Every 15 minutes",
    needsTime: false,
    resolve: () => ({ type: "interval", intervalMs: 15 * 60_000 }),
  },
];

function cronAt(timeOfDay: string, dayOfWeek: string): TaskSchedule {
  const [hh, mm] = timeOfDay.split(":");
  const hour = Number(hh ?? "9");
  const minute = Number(mm ?? "0");
  return { type: "cron", cron: `${minute} ${hour} * * ${dayOfWeek}` };
}

// ---------------------------------------------------------------------------
// Create-task form
// ---------------------------------------------------------------------------

function CreateTaskForm({ onDone }: { onDone: () => void }) {
  const createTask = useTaskStore((s) => s.createTask);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [presetId, setPresetId] = useState<string>("weekdays");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [advanced, setAdvanced] = useState(false);
  const [onceDate, setOnceDate] = useState("");
  const [cronValue, setCronValue] = useState("0 9 * * 1-5");
  const [submitting, setSubmitting] = useState(false);

  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId), [presetId]);

  const handleSubmit = useCallback(async () => {
    if (!label.trim() || !prompt.trim()) return;
    setSubmitting(true);

    let schedule: TaskSchedule;
    if (advanced && onceDate) {
      schedule = { type: "once", runAt: new Date(onceDate).getTime() };
    } else if (advanced) {
      schedule = { type: "cron", cron: cronValue };
    } else if (preset) {
      schedule = preset.resolve(timeOfDay);
    } else {
      setSubmitting(false);
      return;
    }

    const params: CreateTaskParams = {
      label: label.trim(),
      prompt: prompt.trim(),
      schedule,
    };

    const ok = await createTask(params);
    setSubmitting(false);
    if (ok) onDone();
  }, [label, prompt, advanced, onceDate, cronValue, preset, timeOfDay, createTask, onDone]);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Input
        placeholder="Task name"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="text-xs"
      />
      <Textarea
        placeholder="What should the agent do?"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="min-h-[60px] text-xs"
        rows={3}
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] text-muted-foreground">Run</Label>
        {!advanced ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[10px] transition-colors ${
                    presetId === p.id
                      ? "bg-active text-foreground"
                      : "text-muted-foreground hover:bg-hover hover:text-foreground"
                  }`}
                  onClick={() => setPresetId(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset?.needsTime && (
              <Input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="w-24 text-xs"
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Input
              type="datetime-local"
              value={onceDate}
              onChange={(e) => setOnceDate(e.target.value)}
              placeholder="Once at"
              className="text-xs"
            />
            <Input
              value={cronValue}
              onChange={(e) => setCronValue(e.target.value)}
              placeholder="Or cron expression"
              className="text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Fill the date for a one-shot task, or leave it blank and use a cron expression
              (minute, hour, day-of-month, month, day-of-week).
            </p>
          </div>
        )}
        <button
          type="button"
          className="self-start text-[10px] text-muted-foreground/70 hover:text-foreground"
          onClick={() => setAdvanced((a) => !a)}
        >
          {advanced ? "← back to presets" : "Advanced (cron / one-shot)"}
        </button>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting || !label.trim() || !prompt.trim()}
        className="text-xs"
      >
        {submitting ? "Creating..." : "Create"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task panel content
// ---------------------------------------------------------------------------

export function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const init = useTaskStore((s) => s.init);
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [creating, setCreating] = useState(false);

  // init fetches the snapshot and subscribes to the onTasksUpdated push, so
  // tasks the agent creates/toggles/deletes appear without a remount.
  useEffect(() => init(), [init]);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">Scheduled Tasks</span>
        <button
          type="button"
          className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setCreating(!creating)}
        >
          {creating ? "cancel" : "+ new"}
        </button>
      </div>

      {tasks.length === 0 && !creating && (
        <div className="py-4 text-center text-[10px] text-muted-foreground">No scheduled tasks</div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs hover:bg-hover"
            >
              <button
                type="button"
                className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                  task.enabled ? "bg-green-400" : "bg-muted-foreground/30"
                }`}
                onClick={() => void toggleTask(task.id)}
                title={task.enabled ? "Disable" : "Enable"}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate ${!task.enabled ? "text-muted-foreground" : ""}`}>
                  {task.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {formatSchedule(task.schedule)}
                </span>
              </div>
              <button
                type="button"
                className="shrink-0 text-[10px] text-muted-foreground/50 transition-colors hover:text-destructive-foreground"
                onClick={() => void deleteTask(task.id)}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {creating && <CreateTaskForm onDone={() => setCreating(false)} />}
    </div>
  );
}
