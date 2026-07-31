// Skills are folders of instructions pi discovers at startup — prompting, not
// tools. The listing is a table because the interesting facts are comparable
// across rows (when it changed, where it came from, whether the agent actually
// got it); the description is not, so it lives in the row's detail rather than
// a fourth column that would truncate to nothing at this width.

import { Fragment, useCallback, useEffect, useId, useState } from "react";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Textarea } from "@repo/ui/components/textarea";
import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@renderer/lib/bridge";
import type {
  SkillBudgetState,
  SkillInfo,
  SkillScope,
  SkillSource,
} from "@repo/bridge/ipc-registry";

/** Mirrors the `description` cap in the createSkill wire schema — a longer one
 * is rejected host-side, so the form refuses it before the round trip. */
const MAX_DESCRIPTION_CHARS = 1536;

const SKILL_SCOPE_LABELS: Record<SkillScope, string> = {
  user: "User",
  project: "Project",
  temporary: "Temporary",
};

// "Bundled" vs "Added" is the whole truth the host can tell: there is no
// author or publisher behind a skill folder.
const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  bundled: "Bundled",
  added: "Added",
};

/** What a non-`loaded` budget state has to say for itself. `null` is the
 * overwhelmingly common case and renders no chrome at all. */
type BudgetNotice = { tone: "info" | "warning"; badge: string; detail: string };

function budgetNotice(budget: SkillBudgetState): BudgetNotice | null {
  switch (budget.kind) {
    case "loaded":
      return null;
    case "description-trimmed":
      return {
        tone: "info",
        badge: "shortened",
        detail: `The agent's prompt received ${budget.promptChars} of this description's ${budget.originalChars} characters. The skill still runs — shorten the description in SKILL.md so the agent sees all of it.`,
      };
    case "not-loaded":
      return { tone: "warning", badge: "not loaded", detail: notLoadedDetail(budget.reason) };
    default: {
      const unreachable: never = budget;
      return unreachable;
    }
  }
}

function notLoadedDetail(reason: "skill-count"): string {
  switch (reason) {
    case "skill-count":
      return "Too many skills on disk for the agent's prompt, so this one never reached it and the agent cannot invoke it. Remove skills you don't use.";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

function formatUpdated(updatedAt: number | null): string {
  if (updatedAt === null) return "—";
  return new Date(updatedAt).toLocaleDateString(undefined, {
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** The listing is one of three things, never a failure disguised as an empty
 * vault — "no skills" and "couldn't read them" say different things to a user. */
type Listing =
  | { kind: "loading" }
  | { kind: "ready"; skills: SkillInfo[] }
  | { kind: "failed"; message: string };

type Draft = { name: string; description: string; instructions: string };

const EMPTY_DRAFT: Draft = { name: "", description: "", instructions: "" };

/** Saving and showing a validation error are mutually exclusive by
 * construction, and a draft only exists while the form is open. */
type Form =
  | { kind: "closed" }
  | { kind: "editing"; draft: Draft; error: string | null }
  | { kind: "saving"; draft: Draft };

export function SkillsSection() {
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const [form, setForm] = useState<Form>({ kind: "closed" });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const detailIdBase = useId();

  useEffect(() => {
    void getBridge()
      .listSkills()
      .then((list) => setListing({ kind: "ready", skills: list.skills }))
      .catch((error: unknown) =>
        setListing({ kind: "failed", message: errorMessage(error, "Could not read skills.") }),
      );
  }, []);

  const handleCreate = useCallback(async (draft: Draft) => {
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (name === "" || description === "") {
      setForm({ kind: "editing", draft, error: "A name and a description are both required." });
      return;
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      setForm({
        kind: "editing",
        draft,
        error: `The description must be ${MAX_DESCRIPTION_CHARS} characters or fewer.`,
      });
      return;
    }
    setForm({ kind: "saving", draft });
    try {
      const result = await getBridge().createSkill({
        name,
        description,
        instructions: draft.instructions,
      });
      setListing({ kind: "ready", skills: result.skills });
      setCreated(result.skill.name);
      setExpanded(result.skill.filePath);
      setForm({ kind: "closed" });
    } catch (error: unknown) {
      setForm({
        kind: "editing",
        draft,
        error: errorMessage(error, "Could not create the skill."),
      });
    }
  }, []);

  const draft = form.kind === "closed" ? null : form.draft;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Skills</Label>
        {/* Stays MOUNTED while the form is open, hidden by class: a button that
            unmounts itself on click detaches the press target before Base UI's
            outside-press check resolves, and the whole Settings dialog closes. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCreated(null);
            setForm({ kind: "editing", draft: EMPTY_DRAFT, error: null });
          }}
          className={cn(
            "h-auto px-2 py-0.5 text-[10px] text-muted-foreground",
            draft !== null && "hidden",
          )}
        >
          Add skill…
        </Button>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Folders of instructions the agent follows for a recurring job. It reads them when it starts,
        so a new or edited skill applies from the next agent session.
      </p>

      {listing.kind === "loading" && (
        <div className="text-[10px] text-muted-foreground">Loading…</div>
      )}

      {listing.kind === "failed" && (
        <div className="rounded-[10px] bg-muted px-3 py-2 text-[10px] text-destructive">
          {listing.message}
        </div>
      )}

      {listing.kind === "ready" &&
        (listing.skills.length === 0 ? (
          <div className="rounded-[10px] bg-muted px-3 py-2 text-[10px] text-muted-foreground">
            No skills yet. Add one to teach the agent a job you repeat.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[10px] bg-muted">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Skill
                  </th>
                  <th scope="col" className="w-20 px-3 py-1.5 font-medium">
                    Updated
                  </th>
                  <th scope="col" className="w-20 px-3 py-1.5 font-medium">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {listing.skills.map((skill, index) => {
                  const notice = budgetNotice(skill.budget);
                  const isOpen = expanded === skill.filePath;
                  const detailId = `${detailIdBase}-${index}`;
                  return (
                    <Fragment key={skill.filePath}>
                      <tr className="border-t border-border">
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={detailId}
                            onClick={() => setExpanded(isOpen ? null : skill.filePath)}
                            className="flex w-full min-w-0 items-center gap-1 text-left"
                          >
                            <ChevronRightIcon
                              className={cn(
                                "size-3 shrink-0 text-muted-foreground transition-transform",
                                isOpen && "rotate-90",
                              )}
                            />
                            <span className="truncate text-xs text-foreground">{skill.name}</span>
                            {notice !== null && (
                              <Badge
                                variant={notice.tone === "warning" ? "destructive" : "secondary"}
                                className="h-4 shrink-0 gap-0.5 px-1.5 text-[9px] font-normal"
                              >
                                {notice.tone === "warning" && (
                                  <AlertTriangleIcon className="size-2.5" />
                                )}
                                {notice.badge}
                              </Badge>
                            )}
                          </button>
                        </td>
                        <td
                          className="px-3 py-1.5 text-[10px] tabular-nums text-muted-foreground"
                          title={
                            skill.updatedAt === null
                              ? "Modification time unavailable"
                              : new Date(skill.updatedAt).toLocaleString()
                          }
                        >
                          {formatUpdated(skill.updatedAt)}
                        </td>
                        <td className="px-3 py-1.5 text-[10px] text-muted-foreground">
                          {SKILL_SOURCE_LABELS[skill.source]}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-t border-border/50">
                          <td colSpan={3} id={detailId} className="px-3 pb-2 pt-1">
                            <div className="flex flex-col gap-1">
                              <p className="text-[10px] leading-relaxed text-muted-foreground">
                                {skill.description === ""
                                  ? "No description — the agent has only the name to go on."
                                  : skill.description}
                              </p>
                              {notice !== null && (
                                <p
                                  className={cn(
                                    "text-[10px] leading-relaxed",
                                    notice.tone === "warning"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {notice.detail}
                                </p>
                              )}
                              <p className="break-all font-mono text-[9px] text-muted-foreground/70">
                                {SKILL_SCOPE_LABELS[skill.scope]} · {skill.filePath}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {created !== null && draft === null && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Created <span className="font-mono">{created}</span>. The agent picks it up the next time
          it starts.
        </p>
      )}

      {draft !== null && (
        <div className="flex flex-col gap-2 rounded-[10px] bg-muted px-3 py-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Name</span>
            <Input
              value={draft.name}
              onChange={(e) =>
                setForm({ kind: "editing", draft: { ...draft, name: e.target.value }, error: null })
              }
              placeholder="Weekly review"
              className="h-7 text-xs"
            />
            <span className="text-[9px] text-muted-foreground/70">
              Saved as a folder name — “Weekly review” becomes weekly-review.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">
              Description
              <span className="ml-1 tabular-nums text-muted-foreground/70">
                {draft.description.length}/{MAX_DESCRIPTION_CHARS}
              </span>
            </span>
            <Textarea
              value={draft.description}
              onChange={(e) =>
                setForm({
                  kind: "editing",
                  draft: { ...draft, description: e.target.value },
                  error: null,
                })
              }
              placeholder="When the agent should reach for this skill."
              className="min-h-12 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Instructions</span>
            <Textarea
              value={draft.instructions}
              onChange={(e) =>
                setForm({
                  kind: "editing",
                  draft: { ...draft, instructions: e.target.value },
                  error: null,
                })
              }
              placeholder="The steps to follow. Can be left empty and written later in SKILL.md."
              className="min-h-16 text-xs"
            />
          </div>
          {form.kind === "editing" && form.error !== null && (
            <p className="rounded-[8px] bg-card px-2.5 py-1.5 text-[10px] text-destructive">
              {form.error}
            </p>
          )}
          <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setForm({ kind: "closed" })}
              className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleCreate(draft)}
              disabled={form.kind === "saving"}
              className="h-auto px-2 py-0.5 text-[10px] text-foreground"
            >
              {form.kind === "saving" ? "Creating…" : "Create skill"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
