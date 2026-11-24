import type { McpServer } from "@modelcontextprotocol/server";
import { ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";

import canvas from "../agent/prompt/canvas.md?raw";
import fields from "../agent/prompt/fields.md?raw";
import formulas from "../agent/prompt/formulas.md?raw";
import html from "../agent/prompt/html.md?raw";
import items from "../agent/prompt/items.md?raw";
import links from "../agent/prompt/links.md?raw";
import notes from "../agent/prompt/notes.md?raw";
import writing from "../agent/prompt/writing.md?raw";

const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";

const CACHE_HINT = { cacheScope: "public", ttlMs: 60 * 60 * 1000 } as const;

const INVALID_PARAMS = -32_602;

interface SkillFile {
  readonly path: string;
  readonly text: string;
}

interface Skill {
  readonly description: string;
  readonly files: readonly SkillFile[];
  readonly name: string;
}

const NAME = "library-notes";

const DESCRIPTION =
  "Write, edit, save, file and tag items in this Inteligir library: the exact spelling of its blocks beyond plain markdown (links between items, dates, callouts, tabs, toggles, columns, charts, formulas, canvases, HTML) and where items go. Use before create_note, edit_item, save_link or organize_items.";

const REFERENCES = [
  { path: "references/writing.md", text: writing, when: "shaping a note a person will skim" },
  { path: "references/items.md", text: items, when: "saving, finding, filing or tagging items" },
  { path: "references/fields.md", text: fields, when: "changing a title, tag, folder or pin" },
  { path: "references/links.md", text: links, when: "linking items, the web, embeds or files" },
  { path: "references/formulas.md", text: formulas, when: "writing a formula or variable pill" },
  { path: "references/canvas.md", text: canvas, when: "writing or editing a canvas" },
  { path: "references/html.md", text: html, when: "writing an inteligir-html block" },
] as const;

const skillMarkdown = [
  `---\nname: ${NAME}\ndescription: ${JSON.stringify(DESCRIPTION)}\n---`,
  notes.trim(),
  [
    "## Read Next",
    "",
    "Read the one that matches the work before writing it:",
    "",
    ...REFERENCES.map(({ path, when }) => `- [${path}](${path}): ${when}`),
  ].join("\n"),
].join("\n\n");

export const CONNECTOR_SKILLS: readonly Skill[] = [
  {
    description: DESCRIPTION,
    files: [
      { path: "SKILL.md", text: `${skillMarkdown}\n` },
      ...REFERENCES.map(({ path, text }) => ({ path, text })),
    ],
    name: NAME,
  },
];

const uriOf = (skill: Skill, path = "SKILL.md") => `skill://${skill.name}/${path}`;

const fileEntry = async (uri: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  return { digest: `sha256:${hex}`, size: bytes.byteLength, uri };
};

const entryOf = async (skill: Skill) => ({
  frontmatter: { description: skill.description, name: skill.name },
  resources: await Promise.all(
    skill.files.map(async (file) => await fileEntry(uriOf(skill, file.path), file.text)),
  ),
  uri: uriOf(skill),
});

let catalog: Promise<Awaited<ReturnType<typeof entryOf>>[]> | undefined;

/** The skills as `skills/list` lists them: each SKILL.md's address, its frontmatter and every file's digest and size. */
export const connectorSkillCatalog = async () => {
  catalog ??= Promise.all(CONNECTOR_SKILLS.map(entryOf));

  return await catalog;
};

/** Serves the library's skills over the skills extension: each file a `skill://` resource, `skills/list` and `skills/get` its catalog. */
export const registerConnectorSkills = (server: McpServer) => {
  server.server.registerCapabilities({ extensions: { [SKILLS_EXTENSION]: {} }, resources: {} });

  for (const skill of CONNECTOR_SKILLS) {
    for (const file of skill.files) {
      const uri = uriOf(skill, file.path);
      const isSkill = file.path === "SKILL.md";

      server.registerResource(
        isSkill ? skill.name : `${skill.name}/${file.path}`,
        uri,
        {
          cacheHint: CACHE_HINT,
          description: isSkill ? skill.description : undefined,
          mimeType: "text/markdown",
        },
        () => ({ contents: [{ mimeType: "text/markdown", text: file.text, uri }] }),
      );
    }
  }

  server.server.setRequestHandler(
    "skills/list",
    { params: z.looseObject({ cursor: z.string().optional() }) },
    async () => ({ resultType: "complete", skills: await connectorSkillCatalog(), ...CACHE_HINT }),
  );

  server.server.setRequestHandler(
    "skills/get",
    { params: z.looseObject({ uri: z.string() }) },
    async ({ uri }) => {
      const listed = await connectorSkillCatalog();
      const skill = listed.find((entry) => entry.uri === uri);

      if (skill === undefined) {
        throw new ProtocolError(INVALID_PARAMS, `No skill at ${uri}. Call skills/list for them.`);
      }

      return { resultType: "complete", skill, ...CACHE_HINT };
    },
  );
};
