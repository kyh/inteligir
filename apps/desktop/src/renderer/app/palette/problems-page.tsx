import { CommandEmpty, CommandGroup, CommandItem } from "@repo/ui/components/command";
import {
  KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
  type KnowledgeProblemsResponse,
} from "@repo/api/local/knowledge/knowledge-schema";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "../api";
import { matchesQuery, PalettePage, type PageShell } from "./palette-page";

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

function problemFamilies(problems: KnowledgeProblemsResponse, query: string): ProblemFamilyRows[] {
  const families: ProblemFamilyRows[] = [
    {
      id: "unresolved",
      heading: "Unresolved links",
      total: problems.unresolvedLinks.total,
      rows: problems.unresolvedLinks.rows.map((row) => ({
        id: `unresolved ${row.sourcePath} ${row.target}`,
        label: `[[${row.target}]] in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        detail: `${row.sourcePath}:${String(row.line)}`,
        path: row.sourcePath,
        target: row.target,
      })),
    },
    {
      id: "embeds",
      heading: "Missing embeds",
      total: problems.missingEmbeds.total,
      rows: problems.missingEmbeds.rows.map((row) => ({
        id: `embed ${row.sourcePath} ${row.target}`,
        label: `${row.target} in ${row.sourceTitle === "" ? row.sourcePath : row.sourceTitle}`,
        detail: `${row.sourcePath}:${String(row.line)}`,
        path: row.sourcePath,
        target: row.target,
      })),
    },
    {
      id: "orphans",
      heading: "Orphans",
      total: problems.orphans.total,
      rows: problems.orphans.rows.map((row) => ({
        id: `orphan ${row.path}`,
        label: row.title === "" ? row.path : row.title,
        detail: row.path,
        path: row.path,
      })),
    },
    {
      id: "duplicates",
      heading: "Duplicate stems",
      total: problems.duplicateStems.total,
      rows: problems.duplicateStems.rows.flatMap((row) =>
        row.paths.map((path) => ({
          id: `duplicate ${path}`,
          label: row.stem,
          detail: path,
          path,
        })),
      ),
    },
  ];
  for (const family of families) {
    family.rows = family.rows.filter(
      (row) => matchesQuery(row.label, query) || matchesQuery(row.detail, query),
    );
  }
  return families.filter((family) => family.rows.length > 0);
}

function problemsHidden(problems: KnowledgeProblemsResponse): number {
  return [
    problems.unresolvedLinks,
    problems.missingEmbeds,
    problems.orphans,
    problems.duplicateStems,
  ].reduce((hidden, family) => hidden + (family.total - family.rows.length), 0);
}

export interface ProblemsPageProps extends PageShell {
  onOpenNote: (path: string) => void;
  onOpenLink: (sourcePath: string, target: string) => void;
}

export function ProblemsPage({ onOpenNote, onOpenLink, ...shell }: ProblemsPageProps) {
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
  return (
    <PalettePage
      {...shell}
      title="Problems"
      description="What the vault's links cannot resolve"
      placeholder="Filter problems…"
      wide
    >
      <CommandEmpty>
        {problemsQuery.isError
          ? "Could not read the index just now."
          : problems === undefined
            ? "…"
            : shell.query === ""
              ? "No problems: every link resolves, every note is linked, every stem is unique."
              : "No problem matches."}
      </CommandEmpty>
      {families.map((family) => (
        <CommandGroup key={family.id} heading={`${family.heading} · ${family.total}`}>
          {family.rows.map((row) => (
            <CommandItem
              key={row.id}
              value={row.id}
              onSelect={() =>
                row.target === undefined ? onOpenNote(row.path) : onOpenLink(row.path, row.target)
              }
            >
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="ml-auto shrink-0 pl-3 text-xs text-muted-foreground tabular-nums">
                {row.detail}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
      {hidden > 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {hidden} more not shown; `inteligir problems --limit` lists them all.
        </p>
      ) : null}
    </PalettePage>
  );
}
