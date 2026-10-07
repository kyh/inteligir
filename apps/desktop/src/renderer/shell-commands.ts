// The page's one door into the shell: Tauri's invoke and listen over the rows in
// ../ipc-contract.ts. Every answer and every event is parsed here against its row, so a page only
// ever holds a value it knows. A rejected command is a fault, never a refusal, and the page words
// it itself. Outside the shell (a browser tab on the same server) there is no door at all.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { z } from "zod";
import type { CommandRoute, EventRoute } from "../ipc-contract";

export const underShell = (): boolean => isTauri();

export const ask = async <Args extends z.ZodType<InvokeArgs | undefined>, Answer extends z.ZodType>(
  route: CommandRoute<Args, Answer>,
  ...args: z.input<Args> extends undefined ? [] : [z.input<Args>]
): Promise<z.output<Answer>> =>
  route.answer.parse(await invoke(route.command, route.args.parse(args[0])));

// the listener hears only payloads its row parses; the answer stops it
export const hear = <Payload extends z.ZodType>(
  route: EventRoute<Payload>,
  listener: (payload: z.output<Payload>) => void,
): (() => void) => {
  const listening = listen(route.event, (event) => {
    const parsed = route.payload.safeParse(event.payload);
    if (parsed.success) {
      listener(parsed.data);
    }
  });
  const stopListening = async (): Promise<void> => {
    const stop = await listening;
    stop();
  };
  return () => {
    void stopListening();
  };
};
