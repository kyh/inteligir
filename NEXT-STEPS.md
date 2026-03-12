# Next Steps

Roadmap for building the Inteligir desktop AI agent app.

## Current state

- Turborepo monorepo with pnpm workspaces
- Next.js marketing site (`apps/web`) with waitlist form, docs (fumadocs)
- Auth system (better-auth), database (Supabase + Drizzle + PostgreSQL)
- Shared packages: `@repo/api`, `@repo/db`, `@repo/ui`
- No desktop app or AI agent integration yet

## Phase 1: Electron Desktop Shell

Add `apps/desktop` with Electron + electron-vite + React.

- [ ] Scaffold Electron app with electron-vite and React
- [ ] Custom frameless window with title bar
- [ ] Basic layout: sidebar + main content area
- [ ] Dev workflow: `pnpm dev-desktop` runs Electron with HMR
- [ ] Build pipeline for macOS, Windows, Linux

## Phase 2: AI Agent Integration (pi RPC)

Integrate the pi coding agent framework via its JSON-RPC server mode.

- [ ] Spawn pi agent as a child process from Electron main process
- [ ] Communicate over JSON-RPC (stdio or WebSocket)
- [ ] Agent session lifecycle: create, load, switch, destroy
- [ ] Provider configuration UI (API keys for Anthropic, OpenAI, Google, etc.)
- [ ] Model selection

## Phase 3: Chat & Agent UI

Build the visual interface for interacting with the agent.

- [ ] Chat panel with message input and streaming responses
- [ ] Message rendering: user messages, assistant responses, thinking blocks
- [ ] Tool call visualization: bash commands, file reads/writes, search results
- [ ] Human-in-the-loop approval UI for tool executions
- [ ] Diff viewer for file changes the agent makes
- [ ] Session management: list, create, switch, delete sessions

## Phase 4: Chief of Staff Features

The features that make this more than a coding agent.

- [ ] Task breakdown: agent decomposes goals into actionable tasks
- [ ] Task board / progress tracking UI
- [ ] Workflow templates for common tasks (email drafting, meeting prep, research)
- [ ] Calendar awareness (Google Calendar / Outlook)
- [ ] Email drafting and review
- [ ] Daily briefing: automated summary of tasks and priorities

## Phase 5: Polish & Distribution

- [ ] Auto-updates (electron-updater)
- [ ] Onboarding / first-run setup wizard
- [ ] Keyboard shortcuts
- [ ] Integrated terminal (xterm.js + node-pty)
- [ ] Plugin system for custom tools and integrations

## Key decisions still open

- **Electron vs Tauri**: Leaning Electron for Node.js compatibility with pi agent (spawning child processes, node-pty for terminal). Tauri is lighter but adds complexity with the Rust bridge.
- **State management**: Zustand vs tRPC subscriptions for desktop app state
- **Event sourcing**: Whether to adopt event sourcing (like t3code) for agent session history, or keep it simpler with direct state management
- **Shared packages**: How much of `@repo/api` and `@repo/db` to reuse in the desktop app vs. keeping them web-only

## References

- [pi coding agent](https://github.com/nichochar/pi) — the agent framework we plan to integrate
- [t3code](https://github.com/pingdotgg/t3code) — similar project (web GUI for coding agents) worth studying for UI patterns
