import { base } from "../orpc";

const status = base.noteIntelligence.status.handler(({ context }) =>
  context.noteIntelligence.status(),
);

const toggle = base.noteIntelligence.toggle.handler(({ context, input }) =>
  context.noteIntelligence.setEnabled(input.enabled),
);

export const noteIntelligenceRouter = {
  status,
  toggle,
};
