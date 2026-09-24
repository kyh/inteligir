// the thread whose agent shell made a call: the CLI names it on every request it sends from one, so
// a vault write it carries lands in that turn's commit rather than the next auto-commit. it is
// attribution, never authority: the bearer already admitted the caller.
export const AGENT_THREAD_HEADER = "x-inteligir-thread";

export const agentThreadIdOf = (header: string | undefined): string | null => {
  const trimmed = header?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};
