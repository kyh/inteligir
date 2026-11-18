// The library's rows under `/v1/rpc`: the reading side's and the writing side's, merged where both
// route rows under one key, and the built-in agent's beside them.

import { agentReadRows, agentWriteRows } from "../agent/agent-rows";
import { libraryReadRows } from "../library/library-read-rows";
import { libraryWriteRows } from "../library/library-write-rows";

export const libraryRouter = {
  ...libraryReadRows,
  ...libraryWriteRows,
  agent: {
    ...libraryReadRows.agent,
    ...libraryWriteRows.agent,
    ...agentReadRows,
    ...agentWriteRows,
  },
  imports: { ...libraryReadRows.imports, ...libraryWriteRows.imports },
  items: { ...libraryReadRows.items, ...libraryWriteRows.items },
};
