// Note Intelligence's handlers: read the switch's state, and set it. The
// service answers a status for every input the schema admits, so neither row
// declares a refusal.

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
