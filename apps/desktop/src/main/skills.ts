import fs from "node:fs";
import path from "node:path";

import { inteligirPath } from "@/main/lib/json-store";
import type { SkillInfo } from "@/shared/ipc";

/** ~/.inteligir/skills — where seedResources copies bundled SKILL.md dirs. */
const SKILLS_DIR = inteligirPath("skills");

/**
 * List the skills seeded into the user's data dir. Each skill is a directory
 * containing a SKILL.md whose YAML frontmatter carries `name` + `description`.
 * Reads straight from disk (skills aren't part of pi's live tool registry), so
 * this works regardless of agent lifecycle state.
 */
export function listSkills(): SkillInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = fs.readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const front = parseFrontmatter(raw);
    skills.push({
      name: front["name"] ?? entry.name,
      description: front["description"] ?? "",
    });
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * Minimal YAML frontmatter reader for SKILL.md. Handles top-level
 * `key: value` pairs plus folded/literal block scalars (`>` / `|`) whose
 * continuation lines are indented — that's all the SKILL.md format uses.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match?.[1]) return {};

  const lines = match[1].split(/\r?\n/);
  const result: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!keyMatch) continue;

    const key = keyMatch[1] ?? "";
    const inline = (keyMatch[2] ?? "").trim();

    if (inline === ">" || inline === "|") {
      const fold = inline === ">";
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1] ?? "")) {
        block.push((lines[++i] ?? "").trim());
      }
      result[key] = fold ? block.join(" ").trim() : block.join("\n").trim();
    } else {
      result[key] = stripQuotes(inline);
    }
  }

  return result;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'"))) {
    const quote = value[0];
    if (value.endsWith(quote)) return value.slice(1, -1);
  }
  return value;
}
