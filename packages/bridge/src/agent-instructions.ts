// ---------------------------------------------------------------------------
// User-authored agent instructions — the vault/AGENTS.md convention.
//
// `AGENTS.md` at the vault root is the ONE user-facing agent-config surface:
// a regular markdown note the user owns and edits directly, loaded into the
// chat + delegation sessions at start, with a `## Memory` section the agent
// appends durable facts to (the personalization loop). Shared here because
// both the renderer (the "Open agent instructions" palette command) and the
// host (seed + session load) need the same path and skeleton bytes.
//
// It is NOT a private note and gets no special privacy handling — it's just
// a vault file the agent reads (a `private: true` frontmatter mark on it is
// still honored by the host loader, like every other AI surface).
// ---------------------------------------------------------------------------

/** Vault-relative path of the user's agent instructions file. */
export const AGENT_INSTRUCTIONS_PATH = "AGENTS.md";

/** How the agent addresses the same file through its workspace symlink —
 * the label it sees in the system prompt and the path the bundled prompt's
 * write-back nudge tells it to append memory to. Keeping the two identical
 * is what closes the loop. */
export const AGENT_INSTRUCTIONS_AGENT_PATH = "./vault/AGENTS.md";

/** First-use skeleton. Deliberately comment-free markdown: HTML comments are
 * outside the editor's MDX vocabulary and would open the seeded file in Raw
 * mode — the guidance is written as plain prose the agent can read too. */
export const AGENT_INSTRUCTIONS_SKELETON = `# Agent instructions

Custom instructions for the AI agent in this vault. Edit freely — the agent
reads this file at the start of every chat.

## About me / preferences

Add standing instructions here, e.g. "Answer concisely." or "Put meeting
notes in meetings/."

## Memory

The agent appends durable facts it learns about you here.
`;
