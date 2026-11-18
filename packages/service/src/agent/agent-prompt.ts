// How the library's notes are written, each section a file of `./prompt` read as text: an agent
// reads it before it writes a block of the library's own, a connected assistant as the guide and the
// built-in agent after its own instructions, which eve embeds at build
// (apps/web/agent/instructions.ts). Nothing of an account or a request is in either, so their bytes
// change only with those files and every conversation of every account reads one cached prefix.

import builtInAgent from "./prompt/built-in-agent.md?raw";
import canvas from "./prompt/canvas.md?raw";
import fields from "./prompt/fields.md?raw";
import formulas from "./prompt/formulas.md?raw";
import html from "./prompt/html.md?raw";
import items from "./prompt/items.md?raw";
import links from "./prompt/links.md?raw";
import notes from "./prompt/notes.md?raw";
import writing from "./prompt/writing.md?raw";

const joined = (parts: readonly string[]): string => parts.map((part) => part.trim()).join("\n\n");

// the one order the spec's sections are read in: the hub, whose words lean on the ones after it
export const DIALECT_SPEC = joined([notes, writing, items, fields, links, formulas, canvas, html]);

export const AGENT_SYSTEM_PROMPT = joined([builtInAgent, DIALECT_SPEC]);
