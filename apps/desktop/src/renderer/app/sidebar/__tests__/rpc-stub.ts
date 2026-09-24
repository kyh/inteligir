// A rail surface reads through the one oRPC client it ships with, so a test answers the wire
// (`{ json }` in, `{ json }` out) per procedure. An answer that throws is the server refusing the
// call; a procedure with no answer is a 404, which the client logs, so the console gate names it.

import { RPC_PREFIX } from "@repo/api/local/routes";
import { vi } from "vitest";
import { z } from "zod";

const jsonSchema = z.json();
type Json = z.infer<typeof jsonSchema>;

// a procedure with no input sends no `json`
const requestBodySchema = z.object({ json: jsonSchema.optional() });

type Answer = (input: Json | undefined) => Json;

export const stubRpc = (answers: Partial<Record<string, Answer>>): void => {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    const answer = answers[url.pathname.slice(`${RPC_PREFIX}/`.length)];
    if (answer === undefined) {
      return new Response("not stubbed", { status: 404 });
    }
    const { json } = requestBodySchema.parse(JSON.parse(z.string().parse(init?.body ?? "{}")));
    let output: Json;
    try {
      output = answer(json);
    } catch {
      return new Response("refused", { status: 500 });
    }
    return Response.json({ json: output }, { status: 200 });
  });
};
