import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import { KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT } from "@repo/api/local/knowledge/knowledge-schema";
import type { KnowledgeProblemsResponse } from "@repo/api/local/knowledge/knowledge-schema";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../api";
import { matchesQuery, PalettePage } from "./palette-page";
import type { PageShell } from "./palette-page";

// a row opens `path`; with a `target` it lands on that link inside it
interface ProblemRow {
  id: string;
  label: string;
  detail: string;
  path: string;
  target?: string;
}

interface ProblemFamilyRows {
  id: string;
  heading: string;
  total: number;
  rows: ProblemRow[];
}

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
        path: row.sourcePath,
        target: row.target,
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
        path: row.sourcePath,
        target: row.target,
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
        path: row.path,
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
          path,
        })),
      ),
      total: problems.duplicateStems.total,
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
  ].reduce((hidden, family) => hidden + (family.total - family.rows.length), 0);

export interface ProblemsPageProps extends PageShell {
  onOpenNote: (path: string) => void;
  onOpenLink: (sourcePath: string, target: string) => void;
}

export const ProblemsPage = ({ onOpenNote, onOpenLink, ...shell }: ProblemsPageProps) => {
  // read once per visit to the page, not per keystroke: the query filters the rows it holds
  const problemsQuery = useQuery({
    ...orpc.knowledge.problems.queryOptions({
      input: { limit: KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT },
    }),
    enabled: shell.open,
  });
  const problems = problemsQuery.data;
  const families = problems === undefined ? [] : problemFamilies(problems, shell.query);
  const hidden = problems === undefined ? 0 : problemsHidden(problems);

  const emptySentence = (): string => {
    if (problemsQuery.isError) {
      return "Could not read the index just now.";
    }
    if (problems === undefined) {
      return "…";
    }
    return shell.query === ""
      ? "No problems: every link resolves, every note is linked, every stem is unique."
      : "No problem matches.";
  };

  return (
    <PalettePage
      {...shell}
      title="Problems"
      description="What the vault's links cannot resolve"
      placeholder="Filter problems…"
      wide
    >
      <CommandEmpty>{emptySentence()}</CommandEmpty>
      {families.map((family) => (
        <CommandGroup key={family.id} heading={`${family.heading} · ${family.total}`}>
          {family.rows.map((row) => (
            <CommandItem
              key={row.id}
              value={row.id}
              onSelect={() => {
                if (row.target === undefined) {
                  onOpenNote(row.path);
                } else {
                  onOpenLink(row.path, row.target);
                }
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
