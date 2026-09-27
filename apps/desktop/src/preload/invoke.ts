import { ipcRenderer } from "electron";
import type { z } from "zod";

import type { InvokeRoute } from "../ipc-contract";

// the IPC boundary: every answer is parsed here, so the page only ever sees a value it knows.
// A throw that crosses is a fault, not a refusal, and the page words it itself.
export const invoke = async <Request extends z.ZodType, Answer extends z.ZodType>(
  route: InvokeRoute<Request, Answer>,
  ...request: z.input<Request> extends undefined ? [] : [z.input<Request>]
): Promise<z.output<Answer>> =>
  route.answer.parse(await ipcRenderer.invoke(route.channel, ...request));
