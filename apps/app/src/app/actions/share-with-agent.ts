// "Share with agent": one clipboard payload handing an
// EXTERNAL agent — a shell session, another tool — enough to edit this vault
// without breaking it. Static text on purpose: it promises only what is true
// from outside the app (files, git, the dialect), never the in-app agent's
// environment.

export function shareWithAgentText(docPath: string): string {
  return `Note: ${docPath} (vault-relative path)

How to edit this vault:
- The vault is a git repo of plain markdown files; edit this note's file directly — the file is the source of truth.
- Frontmatter (YAML between --- fences) is the only property store; preserve keys you do not understand byte-exactly.
- Notes use the inteligir markdown dialect: [[wiki links]], {{formula}} pills, %%i:id%% comment anchors, and inteligir-* fenced blocks.
- Keep %%m:id%% anchors and HTML comment markers byte-exact; never reflow or strip them.
- Wiki links resolve by note title or alias; renaming a note breaks inbound [[links]] unless they are rewritten too.
- Unsure about a dialect construct? Write plain CommonMark instead of guessing.
- The dialect's full spec ships with the inteligir app as agent skills (inteligir-notes first); read them before authoring dialect constructs if you can reach an install.
- Commit through git as usual; the app watches the working tree and re-indexes on change.`;
}
