// The built-in agent's switch, which the person turns from Settings. It is on by default: there is
// no credential to make, since the agent's tools run in the account's own cell. Off stops every
// open turn as a cancel would, lets go of every send waiting, and refuses sends until it is on
// again; the threads stay readable, and on lets sends in again.

import { z } from "zod";

import type { CellResult } from "../library/cell-refusal";
import { stopEveryTurn } from "./agent-turns";
import type { AgentCell } from "./agent-turns";
import { agentIsOn, setSwitch } from "./turn-rows";

const switchedSchema = z.object({ enabled: z.boolean() });

export const setAgentEnabled = (
  cell: AgentCell,
  input: { readonly enabled: boolean; readonly opId?: string | undefined },
): CellResult<z.infer<typeof switchedSchema>> =>
  cell.library.landApart({ answer: switchedSchema, opId: input.opId }, (scope) => {
    if (agentIsOn(scope.storage.db) !== input.enabled) {
      setSwitch(scope.storage.db, input.enabled);
      if (!input.enabled) {
        stopEveryTurn(scope);
      }
    }
    return { enabled: input.enabled };
  });
