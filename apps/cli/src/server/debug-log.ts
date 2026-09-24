// the decisions these make leave no other trace, so "it didn't update" can come with a log and no
// build. a line names paths, ids and verdicts, never note content and never a credential: it is
// written to be pasted into a public report.

// what each namespace traces, as the guide prints it.
export const DEBUG_TRACES = {
  acp: "every frame traded with an agent adapter, named by method, id and session",
  knowledge: "the index's verdict for each file a pass looked at",
  sync: "each pulled page, where each step of a sync pass stopped, and a pass fenced out by a newer sign-in",
  watcher:
    "every file event, kept or dropped and why, then whether it was stripped as this app's own write, held behind a vault sync, or delivered",
};

export type DebugNamespace = keyof typeof DEBUG_TRACES;

export type DebugLog = (line: string) => void;

export const DEBUG_NAMESPACES = Object.keys(DEBUG_TRACES);

const isDebugNamespace = (value: string): value is DebugNamespace =>
  Object.hasOwn(DEBUG_TRACES, value);

// refused rather than ignored: a misspelt namespace would be a log that never shows up, read as
// "nothing happened".
export const parseDebugNamespaces = (
  name: string,
  rawValue: string,
): ReadonlySet<DebugNamespace> => {
  const namespaces = new Set<DebugNamespace>();
  for (const entry of rawValue.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!isDebugNamespace(trimmed)) {
      throw new Error(
        `${name} must be a comma-separated list of ${DEBUG_NAMESPACES.join(", ")} (got "${trimmed}")`,
      );
    }
    namespaces.add(trimmed);
  }
  return namespaces;
};

// undefined while the namespace is off, so a site spells `debugLog?.(…)`: an optional call never
// evaluates its argument, and an off namespace costs that one read and never builds its line.
export const debugLog = (
  enabled: ReadonlySet<DebugNamespace>,
  namespace: DebugNamespace,
): DebugLog | undefined =>
  enabled.has(namespace)
    ? (line) => {
        console.error(`[debug:${namespace}] ${line}`);
      }
    : undefined;
