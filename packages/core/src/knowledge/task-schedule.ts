// ---------------------------------------------------------------------------
// Task scheduling by ASSOCIATION — pure, config-injected, shared by desktop
// and (when it grows a config source) mobile. A task's schedule is: the first
// of its wiki targets that reads as a date (ISO always, else the user's
// configured daily-note filename pattern), else the date its NOTE's path
// carries under the daily-note convention, else unscheduled. Extraction never
// interprets dates — this module owns the reading, with the folder/format
// config injected (it lives in desktop ui-state, renderer-owned) and the
// clock injected as `todayIso` (core stays pure; dates are LOCAL end-to-end,
// matching formatIsoDate).
// ---------------------------------------------------------------------------

import { dateFromDailyPath, parseDateByPattern } from "../notes/daily-path";

/** Settings → Notes daily-note convention, injected by the platform (desktop:
 * ui-state's notes.dailyFolder / notes.dailyFilenameFormat). */
export type DailyNoteConfig = {
  dailyFolder: string;
  dailyFormat: string;
};

/** Read a wiki target as a date: ISO `YYYY-MM-DD` always parses; otherwise
 * the configured daily filename pattern does (so `[[15-07-2026]]` schedules
 * under a `DD-MM-YYYY` convention). Null for anything else — resolution is
 * irrelevant, the target TEXT is the schedule. */
export function parseDateTarget(target: string, dailyFormat: string): string | null {
  return parseDateByPattern(target, "YYYY-MM-DD") ?? parseDateByPattern(target, dailyFormat);
}

/** A task's scheduled ISO date: (1) its first date-reading wiki target, (2)
 * else the note's own daily-note date, (3) else null (unscheduled). */
export function scheduledDateForTask(
  wikiTargets: readonly string[],
  notePath: string,
  config: DailyNoteConfig,
): string | null {
  for (const target of wikiTargets) {
    const date = parseDateTarget(target.trim(), config.dailyFormat);
    if (date !== null) return date;
  }
  return dateFromDailyPath(notePath, config.dailyFolder, config.dailyFormat);
}

/** What groupTasks needs of a task row — structural, so the wire type
 * (VaultTaskEntry) flows through and comes back whole in each bucket. */
export type SchedulableTask = {
  path: string;
  ordinal: number;
  checked: boolean;
  wikiTargets: string[];
};

export type TaskGroups<T extends SchedulableTask> = {
  /** Scheduled before `todayIso`, oldest first. */
  overdue: Array<T & { date: string }>;
  /** Scheduled exactly `todayIso`. */
  today: Array<T & { date: string }>;
  /** Scheduled after `todayIso`, soonest first. */
  upcoming: Array<T & { date: string }>;
  /** No schedule read — grouped by note downstream (input order kept). */
  unscheduled: T[];
  /** Every checked task, schedule or not (the collapsed section). */
  completed: T[];
};

/** Bucket tasks for the Tasks view. `todayIso` is the caller's LOCAL
 * formatIsoDate(new Date()) — the clock is a capability, injected. Scheduled
 * buckets sort by date, then path, then ordinal; the unscheduled/completed
 * buckets keep the input's (path, ordinal) order. */
export function groupTasks<T extends SchedulableTask>(
  entries: readonly T[],
  config: DailyNoteConfig,
  todayIso: string,
): TaskGroups<T> {
  const groups: TaskGroups<T> = {
    overdue: [],
    today: [],
    upcoming: [],
    unscheduled: [],
    completed: [],
  };
  for (const entry of entries) {
    if (entry.checked) {
      groups.completed.push(entry);
      continue;
    }
    const date = scheduledDateForTask(entry.wikiTargets, entry.path, config);
    if (date === null) groups.unscheduled.push(entry);
    else if (date < todayIso) groups.overdue.push({ ...entry, date });
    else if (date === todayIso) groups.today.push({ ...entry, date });
    else groups.upcoming.push({ ...entry, date });
  }
  groups.overdue.sort(byDate);
  groups.today.sort(byDate);
  groups.upcoming.sort(byDate);
  return groups;
}

/** (date, path, ordinal) ordering for the scheduled buckets. */
function byDate(
  a: SchedulableTask & { date: string },
  b: SchedulableTask & { date: string },
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.ordinal - b.ordinal;
}
