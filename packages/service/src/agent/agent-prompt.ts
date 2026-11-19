import builtInAgent from "./prompt/built-in-agent.md?raw";
import canvas from "./prompt/canvas.md?raw";
import fields from "./prompt/fields.md?raw";
import formulas from "./prompt/formulas.md?raw";
import html from "./prompt/html.md?raw";
import items from "./prompt/items.md?raw";
import links from "./prompt/links.md?raw";
import notes from "./prompt/notes.md?raw";
import writing from "./prompt/writing.md?raw";

const joined = (parts: readonly string[]) => parts.map((part) => part.trim()).join("\n\n");

export const DIALECT_SPEC = joined([notes, writing, items, fields, links, formulas, canvas, html]);

export const AGENT_SYSTEM_PROMPT = joined([builtInAgent, DIALECT_SPEC]);
