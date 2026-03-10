import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight">
          Your AI Chief of Staff
        </h1>
        <p className="text-lg text-white/70">
          Stop context-switching. Inteligir is an AI agent that manages your
          tasks, coordinates your workflows, and keeps everything on track
          &mdash; all from a desktop app that runs locally on your machine.
        </p>
      </div>

      <WaitlistForm />

      <div className="mt-4 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">What it does</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="border-border rounded-lg border p-4">
            <h3 className="font-medium">Task Management</h3>
            <p className="mt-1 text-sm text-white/60">
              Break down complex goals into actionable tasks. Your AI chief of
              staff plans, prioritizes, and tracks progress across all your
              projects.
            </p>
          </div>
          <div className="border-border rounded-lg border p-4">
            <h3 className="font-medium">Workflow Coordination</h3>
            <p className="mt-1 text-sm text-white/60">
              Connect to your tools and coordinate across them. Draft emails,
              manage calendars, triage notifications &mdash; delegate the
              busywork to your AI agent.
            </p>
          </div>
          <div className="border-border rounded-lg border p-4">
            <h3 className="font-medium">Local-First &amp; Private</h3>
            <p className="mt-1 text-sm text-white/60">
              Everything runs on your machine. Your data stays private, your API
              keys stay secure. No cloud lock-in, no subscriptions &mdash; bring
              your own model provider.
            </p>
          </div>
          <div className="border-border rounded-lg border p-4">
            <h3 className="font-medium">Visual Agent Interface</h3>
            <p className="mt-1 text-sm text-white/60">
              See what your agent is doing in real time. Review tool calls,
              approve actions, inspect diffs, and intervene when needed &mdash;
              no terminal required.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ol className="list-inside list-decimal space-y-2 text-white/70">
          <li>Download the desktop app</li>
          <li>Add your AI provider API key (Anthropic, OpenAI, etc.)</li>
          <li>Describe what you need done in natural language</li>
          <li>
            Your AI chief of staff plans and executes, asking for approval when
            needed
          </li>
        </ol>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Open source</h2>
        <p className="text-white/70">
          Inteligir is fully open source, built on top of proven agent
          frameworks. It provides a graphical interface for AI agents that can
          read files, write code, run commands, and interact with external
          services &mdash; all with human-in-the-loop approval.
        </p>
      </div>
    </main>
  );
};

export default Page;
