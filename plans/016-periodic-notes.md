# Plan 016: Generalize the daily note into periodic notes (weekly / monthly)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/lib/apply-template.ts apps/desktop/src/renderer/workspace/use-note-templates.ts apps/desktop/src/renderer/command/command-palette.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (feature)
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The daily note exists end-to-end — configurable folder, filename format, a seed template, a palette command, and a ⌘D shortcut — but that whole machine is hard-scoped to ONE cadence. Weekly and monthly notes are table stakes for the journaling use case the daily note already courts, and the existing implementation is a near-perfect blueprint: the pure date/path helpers are already extracted and unit-tested. This is parameterization, not new machinery. The only real design work is the week-numbering convention.

## Current state

- `apps/desktop/src/renderer/lib/apply-template.ts:1-45` — the pure helpers, already extracted and tested (`apply-template.test.ts` exists):

```ts
/** ui-state keys + defaults for the Settings → Notes section. The palette and
 * the settings panel both read these, so they live with the pure helpers. */
export const DAILY_FOLDER_KEY = "notes.dailyFolder";
export const DAILY_FORMAT_KEY = "notes.dailyFilenameFormat";
export const DEFAULT_DAILY_FOLDER = "journal";
export const DEFAULT_DAILY_FORMAT = "YYYY-MM-DD";

/** The template folder convention and the optional daily-note seed template. */
export const TEMPLATES_DIR = "templates";
export const DAILY_TEMPLATE_PATH = "templates/daily.md";
```

and:

```ts
/** Expand `YYYY`/`MM`/`DD` tokens in a daily-note filename pattern (local
 * time). Any other characters pass through literally. Longest tokens first so
 * `YYYY` never leaves a stray `YY`. */
export function formatDatePattern(pattern: string, date: Date): string {
  return pattern
    .replaceAll("YYYY", String(date.getFullYear()))
    .replaceAll("MM", pad2(date.getMonth() + 1))
    .replaceAll("DD", pad2(date.getDate()));
}

/** Vault-relative path for the daily note: `<folder>/<formatted-date>.md`.
 * A blank folder puts the note at the vault root. */
export function dailyNotePath(folder: string, filenameFormat: string, date: Date): string {
```

Note the module's stated discipline: **no dayjs/date-fns — hand-rolled local-time math**. Keep it that way (adding a date library is the operator's call; if you think one is needed, STOP and report).

- `apps/desktop/src/renderer/workspace/use-note-templates.ts:1-20` — the hook wiring, imports exactly the DAILY_* constants above.
- `apps/desktop/src/renderer/command/command-palette.tsx:359-365` — the single periodic command:

```tsx
{
  value: "daily",
  keywords: "open today daily note journal ⌘d",
  icon: <CalendarDaysIcon />,
  label: "Open today's note",
  onSelect: () => openDailyNote(),
},
```

- Settings → Notes already has a section reading `DAILY_FOLDER_KEY` / `DAILY_FORMAT_KEY` from ui-state (find it: `grep -rn "DAILY_FOLDER_KEY" apps/desktop/src/renderer/`). ui-state persists under `~/.inteligir` (never in the vault).
- The `{{date}}` / `{{title}}` template substitution is fixed-vocabulary and byte-honest ("substitutes ONLY the fixed placeholder set, leaving every other byte untouched") — do not widen the placeholder set casually.

## The one real design decision: week numbering

Weekly notes need a week key, and week numbering is a genuine trap (ISO-8601 weeks start Monday and week 1 is the week containing the first Thursday; US convention starts Sunday; naive "day-of-year / 7" is wrong at year boundaries). **Use ISO-8601 week-numbering** (`YYYY-Www`, e.g. `2026-W03`) — it's the standard, it's what Obsidian's periodic-notes plugin defaults to, and it's unambiguous at year boundaries (a January date can legitimately fall in week 52/53 of the PREVIOUS ISO year — the ISO week-year is NOT always the calendar year, and this is the #1 bug in hand-rolled implementations).

Implement `isoWeek(date): {weekYear: number, week: number}` from scratch (no date lib), and TEST IT AGAINST THE KNOWN-HARD CASES listed in the test plan. If you cannot make every one of those cases pass, STOP and report — a subtly wrong week number silently files notes in the wrong week forever, and users won't notice until the year boundary.

## Commands you will need

| Purpose       | Command                                                                              | Expected |
| ------------- | ------------------------------------------------------------------------------------ | -------- |
| Format        | `pnpm format:fix` (FIRST)                                                            | exit 0   |
| Typecheck     | `pnpm typecheck`                                                                     | exit 0   |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                   | all pass |
| Dev harness   | `pnpm --filter @repo/desktop dev:harness`                                            | :5173    |
| Full gates    | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- `apps/desktop/src/renderer/lib/apply-template.ts` — parameterize by cadence; add ISO-week math
- `apps/desktop/src/renderer/lib/apply-template.test.ts` (or wherever its test lives) — extend
- `apps/desktop/src/renderer/workspace/use-note-templates.ts` — cadence-aware
- `apps/desktop/src/renderer/command/command-palette.tsx` — add "Open this week's note" / "Open this month's note"
- The Settings → Notes section — per-cadence folder/format rows

**Out of scope**:

- Quarterly/yearly cadences — add the seam, but ship weekly + monthly only. (Say in the code comment that the cadence type is the extension point.)
- A date library dependency — hand-rolled, as the module already is.
- Changing the `{{date}}`/`{{title}}` placeholder vocabulary. (A `{{week}}` placeholder is tempting — DEFER it; it widens the template contract and needs its own thought.)
- The daily note's existing defaults/behavior — the daily path must keep working byte-identically, including its existing ui-state keys (do NOT rename `notes.dailyFolder` — that would silently reset every existing user's config).
- Calendar UI / date picker — not this plan.

## Git workflow

- Branch: `kyh/plan-016-periodic-notes`
- Conventional commit, e.g. `feat(desktop): weekly and monthly periodic notes`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Model the cadence

In `apply-template.ts`, introduce a discriminated cadence type (`type Cadence = "daily" | "weekly" | "monthly"`) and derive per-cadence ui-state keys, defaults, and template paths from it — a lookup keyed by cadence, not three parallel constant sets. Repo rule: make illegal states unrepresentable; a cadence with no config must not be constructible. KEEP the existing `DAILY_*` constant names and values exactly as they are (other modules import them and users' persisted ui-state depends on the key strings) — the new structure should produce those same key strings for the daily cadence.

Defaults to use: weekly → folder `journal`, format `YYYY-[W]ww` (or your token choice — document it), template `templates/weekly.md`; monthly → folder `journal`, format `YYYY-MM`, template `templates/monthly.md`.

**Verify**: `pnpm typecheck` → exit 0; existing `apply-template` tests still pass UNCHANGED (`pnpm --filter @repo/desktop test`).

### Step 2: ISO week math

Add `isoWeek(date)` and extend `formatDatePattern` with week tokens (e.g. `ww` → zero-padded ISO week, and the ISO week-YEAR where the pattern needs it — note this is NOT necessarily `date.getFullYear()`). Preserve the existing "longest tokens first" discipline so `YYYY` never leaves a stray `YY` and your new tokens don't collide with `MM`/`DD`.

**Verify**: the new week tests (below) pass.

### Step 3: Wire the cadences through

`use-note-templates.ts` gains cadence-parameterized open/create; the palette gains "Open this week's note" and "Open this month's note" (mirror the existing daily entry's shape — value, keywords, icon, label, onSelect); Settings → Notes gains folder/format rows per cadence, mirroring the daily rows. ⌘D stays daily-only (do not invent new global shortcuts — the operator can add them if wanted; note this in your report).

**Verify**: `pnpm typecheck` → exit 0. Dev harness: all three commands appear in the palette and create/open the right paths.

### Step 4: Drive it

In the dev harness: run each of the three palette commands; confirm the created path matches the configured folder/format; confirm re-running opens the EXISTING note rather than creating a duplicate; confirm a configured template seeds the new note and `{{date}}`/`{{title}}` expand.

**Verify**: all four behaviors observed; report them.

### Step 5: Gates

`pnpm format:fix`, then full gates.

**Verify**: exit 0.

## Test plan

Extend the existing `apply-template` test file (it's the structural pattern to follow). **ISO week cases that MUST pass** (these are the ones hand-rolled implementations get wrong):

- 2026-01-01 (a Thursday) → ISO week 1 of week-year 2026.
- 2021-01-01 (a Friday) → ISO **week 53 of week-year 2020** (the week-year differs from the calendar year — this is the case that breaks naive implementations).
- 2024-12-30 (a Monday) → ISO **week 1 of week-year 2025** (a December date in next year's week 1).
- 2020-12-31 → week 53 of 2020 (2020 is a 53-week ISO year).
- 2026-12-28 → week 53 of 2026 if applicable — compute the expected value from the ISO rule, don't guess.
- A mid-year ordinary case, e.g. 2026-07-12 (a Sunday) → the week containing it, Sunday being the LAST day of an ISO week.

Also: daily paths unchanged (regression); monthly path formatting; per-cadence folder/format read from ui-state with correct defaults; a blank folder puts the note at the vault root (existing daily behavior — preserve for all cadences).

## Done criteria

- [ ] All six ISO week cases above pass as explicit test cases
- [ ] Existing daily tests pass UNCHANGED and daily ui-state keys are byte-identical strings (`grep -n "notes.dailyFolder" apps/desktop/src/renderer/lib/apply-template.ts` → still present)
- [ ] Three palette commands exist (today / this week / this month)
- [ ] Settings → Notes exposes folder+format per cadence
- [ ] Step 4's four behaviors verified in the running harness and reported
- [ ] Full gates green; `plans/README.md` updated

## STOP conditions

- Any of the ISO week cases can't be made to pass — STOP and report. Do NOT ship approximate week math; a wrong week number is a silent, permanent misfiling.
- You conclude a date library is needed — STOP and report (dependency additions are the operator's call; the module is deliberately dependency-free).
- Parameterizing the cadence would require renaming the existing `notes.dailyFolder` / `notes.dailyFilenameFormat` ui-state keys — STOP; those keys are persisted user config and renaming them resets everyone's settings.
- The template substitution would need new placeholders to make weekly notes useful — STOP and report; widening the placeholder vocabulary is a contract change.

## Maintenance notes

- The cadence lookup is the extension point for quarterly/yearly — deliberately not built. Whoever adds them touches one table, not five call sites (that's the point of this plan's shape).
- ISO week-year ≠ calendar year. Anyone touching `isoWeek` must keep the year-boundary tests; they exist because the bug is invisible for eleven months of the year.
- Reviewer: check the daily ui-state keys are untouched (a rename is a silent user-config wipe) and that re-opening an existing periodic note doesn't overwrite it with a fresh template.
- Deferred: a `{{week}}` template placeholder, ⌘-shortcuts for weekly/monthly, and a calendar picker.
