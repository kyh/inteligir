import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { toast } from "@repo/ui/components/sonner";
import { KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT } from "@repo/api/local/knowledge/knowledge-schema";
import type { KnowledgeProblemsResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { giveNoteOwnId } from "@repo/api/local/vault/give-note-own-id";
import type { NoteOwnId } from "@repo/api/local/vault/give-note-own-id";
import { flushOpenNote } from "@repo/editor/note/open-note-flush";
import { useMutation, useQuery } from "@tanstack/react-query";
import { client, failed, orpc, refusalMessage } from "../api";
import { matchesQuery, PalettePage } from "./palette-page";

// a note sharing another's id, picked to take one of its own; `keeping` stay on the shared id
interface OwnIdPick {
  kind: "own-id";
  path: string;
  id: string;
  keeping: readonly string[];
}

// what picking a row does: open the note, land on a link written inside it, or give it its own id
type ProblemPick =
  | { kind: "open"; path: string }
  | { kind: "link"; path: string; target: string }
  | OwnIdPick;

interface ProblemRow {
  id: string;
  label: string;
  detail: string;
  pick: ProblemPick;
}

interface ProblemFamilyRows {
  id: string;
  heading: string;
  total: number;
  rows: ProblemRow[];
}

const GIVE_OWN_ID = "Give its own id";

const problemFamilies = (
  problems: KnowledgeProblemsResponse,
  query: string,
): ProblemFamilyRows[] => {
  const families: ProblemFamilyRows[] = [
    {
      heading: "Unresolved links",
      id: "unresolved",
      rows: problems.unresolvedLinks.rows.map((row) => ({
        detail: `${row.sourcePath}:${String(row.line)}`,
        id: `unresolved ${row.sourcePath} ${row.target}`,
        label: `[[${row.target}]] in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        pick: { kind: "link", path: row.sourcePath, target: row.target },
      })),
      total: problems.unresolvedLinks.total,
    },
    {
      heading: "Missing embeds",
      id: "embeds",
      rows: problems.missingEmbeds.rows.map((row) => ({
        detail: `${row.sourcePath}:${String(row.line)}`,
        id: `embed ${row.sourcePath} ${row.target}`,
        label: `${row.target} in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        pick: { kind: "link", path: row.sourcePath, target: row.target },
      })),
      total: problems.missingEmbeds.total,
    },
    {
      heading: "Orphans",
      id: "orphans",
      rows: problems.orphans.rows.map((row) => ({
        detail: row.path,
        id: `orphan ${row.path}`,
        label: row.title === "" ? row.path : row.title,
        pick: { kind: "open", path: row.path },
      })),
      total: problems.orphans.total,
    },
    {
      heading: "Duplicate stems",
      id: "duplicates",
      rows: problems.duplicateStems.rows.flatMap((row) =>
        row.paths.map((path) => ({
          detail: path,
          id: `duplicate ${path}`,
          label: row.stem,
          pick: { kind: "open", path },
        })),
      ),
      total: problems.duplicateStems.total,
    },
    {
      heading: "Duplicate ids",
      id: "duplicate-ids",
      rows: problems.duplicateIds.rows.flatMap((row) =>
        row.paths.map((path) => ({
          detail: path,
          id: `duplicate-id ${path}`,
          label: row.id,
          pick: {
            id: row.id,
            keeping: row.paths.filter((other) => other !== path),
            kind: "own-id",
            path,
          },
        })),
      ),
      total: problems.duplicateIds.total,
    },
  ];
  for (const family of families) {
    family.rows = family.rows.filter(
      (row) => matchesQuery(row.label, query) || matchesQuery(row.detail, query),
    );
  }
  return families.filter((family) => family.rows.length > 0);
};

const problemsHidden = (problems: KnowledgeProblemsResponse): number =>
  [
    problems.unresolvedLinks,
    problems.missingEmbeds,
    problems.orphans,
    problems.duplicateStems,
    problems.duplicateIds,
  ].reduce((hidden, family) => hidden + (family.total - family.rows.length), 0);

const ownIdToast = (path: string, outcome: NoteOwnId): void => {
  switch (outcome.kind) {
    case "done": {
      toast.success(
        outcome.comments === "copied"
          ? `${path} has its own id now, and its comments came with it.`
          : `${path} has its own id now.`,
      );
      return;
    }
    case "changed": {
      toast.warning(`${path} changed since this list was read, so it was left as it is.`);
      return;
    }
    case "invalid": {
      toast.error(`Could not give ${path} its own id: its frontmatter is not valid YAML.`);
      return;
    }
    case "failed": {
      toast.error(
        `Could not give ${path} its own id: ${refusalMessage(outcome.error, "the vault refused it")}`,
      );
      return;
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
};

const listOfPaths = (paths: readonly string[]): string =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(paths);

export interface ProblemsPageProps {
  open: boolean;
  query: string;
  // the note the editor holds, whose unsaved edits land before a write to it
  openNotePath: string | null;
  onOpenNote: (path: string) => void;
  onOpenLink: (sourcePath: string, target: string) => void;
}

export const ProblemsPage = ({
  open,
  query,
  openNotePath,
  onOpenNote,
  onOpenLink,
}: ProblemsPageProps) => {
  // read once per visit to the page, not per keystroke: the query filters the rows it holds
  const problemsQuery = useQuery({
    ...orpc.knowledge.problems.queryOptions({
      input: { limit: KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT },
    }),
    enabled: open,
  });
  const problems = problemsQuery.data;
  const families = problems === undefined ? [] : problemFamilies(problems, query);
  const hidden = problems === undefined ? 0 : problemsHidden(problems);

  const giveOwnId = useMutation({
    mutationFn: async (pick: OwnIdPick): Promise<NoteOwnId> => {
      if (pick.path === openNotePath) {
        await flushOpenNote();
      }
      return await giveNoteOwnId(client, pick.path, pick.id);
    },
    onError: (error, pick) => {
      failed(error, `Could not give ${pick.path} its own id.`);
    },
    onSettled: () => {
      void problemsQuery.refetch();
    },
    onSuccess: (outcome, pick) => {
      ownIdToast(pick.path, outcome);
    },
  });

  const confirmOwnId = async (pick: OwnIdPick): Promise<void> => {
    const confirmed = await confirm({
      body: `The current id stays with ${listOfPaths(pick.keeping)}, and so do the links and actions made with it. This copy gets a new one, and its comments come with it.`,
      confirmLabel: GIVE_OWN_ID,
      title: `Give ${pick.path} its own id?`,
    });
    if (confirmed) {
      giveOwnId.mutate(pick);
    }
  };

  const choose = (pick: ProblemPick): void => {
    switch (pick.kind) {
      case "open": {
        onOpenNote(pick.path);
        return;
      }
      case "link": {
        onOpenLink(pick.path, pick.target);
        return;
      }
      case "own-id": {
        void confirmOwnId(pick);
        return;
      }
      default: {
        const exhaustive: never = pick;
        return exhaustive;
      }
    }
  };

  const emptySentence = (): string => {
    if (problemsQuery.isError) {
      return "Could not read the index just now.";
    }
    if (problems === undefined) {
      return "…";
    }
    return query === ""
      ? "No problems: every link resolves, every note is linked, every stem and id is unique."
      : "No problem matches.";
  };

  return (
    <PalettePage>
      <CommandEmpty>{emptySentence()}</CommandEmpty>
      {families.map((family) => (
        <CommandGroup key={family.id} heading={`${family.heading} · ${family.total}`}>
          {family.rows.map((row) => (
            <CommandItem
              key={row.id}
              action={row.pick.kind === "own-id" ? GIVE_OWN_ID : row.label}
              disabled={row.pick.kind === "own-id" && giveOwnId.isPending}
              onSelect={() => {
                choose(row.pick);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="ml-auto shrink-0 pl-3 text-body text-muted-foreground tabular-nums">
                {row.detail}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
      {hidden > 0 ? (
        <p className="px-3 py-2 text-body text-muted-foreground">
          {hidden} more not shown; `inteligir problems --limit` lists them all.
        </p>
      ) : null}
    </PalettePage>
  );
};
