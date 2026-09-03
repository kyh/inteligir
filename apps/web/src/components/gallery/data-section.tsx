// Data: rows, diffs, and code — the surfaces that show a reader what an agent
// found or is about to change.

import {
  CodeBlock,
  CodeBlockBody,
  CodeBlockCopy,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  CodeToken,
} from "@repo/ui/ai/code-block";
import {
  DiffCell,
  DiffIncludedMark,
  DiffRow,
  DiffTable,
  DiffTableBody,
  DiffTableFooter,
  DiffTableGrid,
  DiffTableHead,
  DiffTableHeadCell,
  DiffTableHeader,
} from "@repo/ui/ai/diff-table";
import {
  DataTable,
  DataTableCell,
  DataTableHeader,
  DataTableRow,
  FilterChip,
  FilterChips,
  FilterTable,
  StatusPill,
} from "@repo/ui/ai/filter-table";
import {
  Flowchart,
  FlowchartBranch,
  FlowchartCondition,
  FlowchartConnector,
  FlowchartNode,
  FlowchartNodeCaption,
  FlowchartNodeTitle,
} from "@repo/ui/ai/flowchart";
import { GlideList } from "@repo/ui/ai/glide-list";
import {
  RecordsAddColumn,
  RecordsCell,
  RecordsColumnHeader,
  RecordsRow,
  RecordsTable,
  RecordsTableBody,
  RecordsTableHeader,
  RecordTag,
} from "@repo/ui/ai/records-table";
import {
  SearchEmpty,
  SearchField,
  SearchPanel,
  SearchResult,
  SearchResults,
} from "@repo/ui/ai/search";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

const TABLE_COLUMNS = "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)";
const DIFF_COLUMNS = ["2rem", "minmax(0,1fr)", "minmax(0,1fr)"] as const;

const NOTES = [
  { title: "Release checklist", status: "indexed", links: "4" },
  { title: "Weekly review", status: "indexed", links: "2" },
  { title: "Kitchen Sink", status: "pending", links: "0" },
];

export function DataSection() {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("back");
  const [included, setIncluded] = useState<ReadonlySet<string>>(new Set(["title"]));

  const results = NOTES.filter((note) =>
    note.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <GallerySection id="data" title="Data">
      <Demo
        name="CodeBlock · CodeBlockLine · CodeToken"
        purpose="Code with a header and a copy button. Tokens are the caller's — no highlighter ships."
        stack
      >
        <div className="w-full max-w-md">
          <CodeBlock code={'const vault = await openVault("~/notes");'}>
            <CodeBlockHeader>
              <CodeBlockTitle language="ts">vault.ts</CodeBlockTitle>
              <CodeBlockCopy />
            </CodeBlockHeader>
            <CodeBlockBody>
              <CodeBlockLine>
                <CodeToken tone="keyword">const</CodeToken> vault ={" "}
                <CodeToken tone="keyword">await</CodeToken> openVault(
                <CodeToken tone="string">&quot;~/notes&quot;</CodeToken>);
              </CodeBlockLine>
              <CodeBlockLine>
                <CodeToken tone="punctuation">{"// four notes, one unresolved link"}</CodeToken>
              </CodeBlockLine>
            </CodeBlockBody>
          </CodeBlock>
        </div>
      </Demo>

      <Demo
        name="DiffTable · DiffRow · DiffCell"
        purpose="A before/after the reader can accept row by row, before anything is written."
        stack
      >
        <div className="w-full max-w-lg">
          <DiffTable>
            <DiffTableHeader hint="2 of 3 fields changed" />
            <DiffTableGrid widths={DIFF_COLUMNS}>
              <DiffTableHead>
                <DiffTableHeadCell />
                <DiffTableHeadCell>Current</DiffTableHeadCell>
                <DiffTableHeadCell>Proposed</DiffTableHeadCell>
              </DiffTableHead>
              <DiffTableBody>
                {[
                  { id: "title", before: "Release checklist", after: "Release checklist v2" },
                  { id: "status", before: "draft", after: "review" },
                ].map((row) => (
                  <DiffRow
                    key={row.id}
                    change="added"
                    included={included.has(row.id)}
                    onToggle={() => {
                      setIncluded((prior) => {
                        const next = new Set(prior);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      });
                    }}
                  >
                    <DiffIncludedMark />
                    <DiffCell>{row.before}</DiffCell>
                    <DiffCell>{row.after}</DiffCell>
                  </DiffRow>
                ))}
              </DiffTableBody>
            </DiffTableGrid>
            <DiffTableFooter>{included.size} of 2 changes selected</DiffTableFooter>
          </DiffTable>
        </div>
      </Demo>

      <Demo
        name="FilterTable · FilterChips · DataTable · StatusPill"
        purpose="Rows narrowed by a chip. The chips are the query; the table is the answer."
        stack
      >
        <div className="w-full max-w-lg">
          <FilterTable>
            <FilterChips>
              {["All", "Indexed", "Pending"].map((label) => (
                <FilterChip
                  key={label}
                  active={filter === label}
                  count={label === "All" ? NOTES.length : undefined}
                  onClick={() => {
                    setFilter(label);
                  }}
                >
                  {label}
                </FilterChip>
              ))}
            </FilterChips>
            <DataTable columns={TABLE_COLUMNS} label="Notes">
              <DataTableHeader>
                <DataTableCell>Note</DataTableCell>
                <DataTableCell>Status</DataTableCell>
                <DataTableCell>Links</DataTableCell>
              </DataTableHeader>
              {NOTES.filter((note) => filter === "All" || note.status === filter.toLowerCase()).map(
                (note) => (
                  <DataTableRow key={note.title}>
                    <DataTableCell>{note.title}</DataTableCell>
                    <DataTableCell>
                      <StatusPill>{note.status}</StatusPill>
                    </DataTableCell>
                    <DataTableCell>{note.links}</DataTableCell>
                  </DataTableRow>
                ),
              )}
            </DataTable>
          </FilterTable>
        </div>
      </Demo>

      <Demo
        name="SearchPanel · SearchField · SearchResults"
        purpose="A query and its rows, with an empty state that says which query found nothing."
        stack
      >
        <div className="w-full max-w-md">
          <SearchPanel>
            <SearchField
              value={query}
              placeholder="Search notes"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onClear={() => {
                setQuery("");
              }}
            />
            <SearchResults>
              {results.length === 0 ? (
                <SearchEmpty hint="Try a shorter query.">Nothing matches “{query}”.</SearchEmpty>
              ) : (
                results.map((note) => <SearchResult key={note.title}>{note.title}</SearchResult>)
              )}
            </SearchResults>
          </SearchPanel>
        </div>
      </Demo>

      <Demo
        name="RecordsTable · RecordsRow · RecordTag"
        purpose="A spreadsheet-shaped view of notes: resizable columns, a tag per cell, a column you can add."
        stack
      >
        <div className="w-full max-w-lg">
          <RecordsTable defaultWidths={{ title: 200, status: 120 }} label="Notes">
            <RecordsTableHeader>
              <RecordsColumnHeader column="title" resizable>
                Note
              </RecordsColumnHeader>
              <RecordsColumnHeader column="status" resizable>
                Status
              </RecordsColumnHeader>
              <RecordsAddColumn />
            </RecordsTableHeader>
            <RecordsTableBody>
              {NOTES.map((note) => (
                <RecordsRow key={note.title}>
                  <RecordsCell column="title">{note.title}</RecordsCell>
                  <RecordsCell column="status" pending={note.status === "pending"}>
                    <RecordTag>{note.status}</RecordTag>
                  </RecordsCell>
                </RecordsRow>
              ))}
            </RecordsTableBody>
          </RecordsTable>
        </div>
      </Demo>

      <Demo
        name="Flowchart · FlowchartNode · FlowchartBranch"
        purpose="A path with a decision in it — how a rule will run, before it runs."
        stack
      >
        <div className="w-full max-w-md">
          <Flowchart>
            <FlowchartNode kind="Trigger">
              <FlowchartNodeTitle>Note saved</FlowchartNodeTitle>
              <FlowchartNodeCaption>Any note in the vault</FlowchartNodeCaption>
            </FlowchartNode>
            <FlowchartConnector label="then" />
            <FlowchartCondition operator="is" value="empty">
              Frontmatter description
            </FlowchartCondition>
            <FlowchartBranch>
              <FlowchartNode kind="Action">
                <FlowchartNodeTitle>Infer a description</FlowchartNodeTitle>
              </FlowchartNode>
              <FlowchartNode kind="Skip">
                <FlowchartNodeTitle>Leave it alone</FlowchartNodeTitle>
              </FlowchartNode>
            </FlowchartBranch>
          </Flowchart>
        </div>
      </Demo>

      <Demo
        name="GlideList"
        purpose="A list whose hover highlight slides between rows instead of blinking onto each."
        note="Ours, not vendored — several Beautiful UI components composed it without shipping it."
        stack
      >
        <GlideList className="w-64 rounded-lg border border-line p-1">
          {NOTES.map((note) => (
            <button
              key={note.title}
              type="button"
              data-menu-row
              className="relative z-10 block w-full rounded-md px-2 py-1.5 text-left text-sm outline-none"
            >
              {note.title}
            </button>
          ))}
        </GlideList>
      </Demo>
    </GallerySection>
  );
}
