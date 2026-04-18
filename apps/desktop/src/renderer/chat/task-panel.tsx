import { useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";

import { formatSchedule, type CreateTaskParams, type TaskSchedule } from "@/shared/task";
import { useTaskStore } from "@/renderer/stores/task-store";

// ---------------------------------------------------------------------------
// Create task form
// ---------------------------------------------------------------------------

type ScheduleType = "cron" | "interval" | "once";

function CreateTaskForm({ onDone }: { onDone: () => void }) {
  const createTask = useTaskStore((s) => s.createTask);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("cron");
  const [cronValue, setCronValue] = useState("0 9 * * 1-5");
  const [intervalMins, setIntervalMins] = useState("60");
  const [onceDate, setOnceDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!label.trim() || !prompt.trim()) return;
    setSubmitting(true);

    let schedule: TaskSchedule;
    switch (scheduleType) {
      case "cron":
        schedule = { type: "cron", cron: cronValue };
        break;
      case "interval":
        schedule = { type: "interval", intervalMs: Number(intervalMins) * 60_000 };
        break;
      case "once":
        schedule = { type: "once", runAt: new Date(onceDate).getTime() };
        break;
    }

    const params: CreateTaskParams = {
      label: label.trim(),
      prompt: prompt.trim(),
      schedule,
    };

    const ok = await createTask(params);
    setSubmitting(false);
    if (ok) onDone();
  }, [label, prompt, scheduleType, cronValue, intervalMins, onceDate, createTask, onDone]);

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
        <Label className="text-[10px] text-muted-foreground">Schedule</Label>
        <div className="flex gap-1">
          {(["cron", "interval", "once"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                scheduleType === t
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setScheduleType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {scheduleType === "cron" && (
          <Input
            placeholder="0 9 * * 1-5"
            value={cronValue}
            onChange={(e) => setCronValue(e.target.value)}
            className="text-xs"
          />
        )}
        {scheduleType === "interval" && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              placeholder="60"
              value={intervalMins}
              onChange={(e) => setIntervalMins(e.target.value)}
              className="w-20 text-xs"
            />
            <span className="text-[10px] text-muted-foreground">minutes</span>
          </div>
        )}
        {scheduleType === "once" && (
          <Input
            type="datetime-local"
            value={onceDate}
            onChange={(e) => setOnceDate(e.target.value)}
            className="text-xs"
          />
        )}
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
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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
        <div className="py-4 text-center text-[10px] text-muted-foreground">
          No scheduled tasks
        </div>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary/50"
            >
              <button
                type="button"
                className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                  task.enabled ? "bg-green-400" : "bg-muted-foreground/30"
                }`}
                onClick={() => toggleTask(task.id)}
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
                onClick={() => deleteTask(task.id)}
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
