import fs from "node:fs";
import { z } from "zod";

import { inteligirPath } from "@/main/lib/json-store";

const ACTIVE_TOOLS_PATH = inteligirPath("active-tools.json");

const ActiveToolsSchema = z.array(z.string());

export function getPersistedActiveTools(): string[] | null {
  if (!fs.existsSync(ACTIVE_TOOLS_PATH)) return null;
  try {
    const raw = fs.readFileSync(ACTIVE_TOOLS_PATH, "utf8");
    const parsed = ActiveToolsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    console.warn("[active-tools] failed to read:", err);
    return null;
  }
}

export function persistActiveTools(toolNames: string[]): void {
  try {
    fs.writeFileSync(ACTIVE_TOOLS_PATH, JSON.stringify(toolNames));
  } catch (err) {
    console.warn("[active-tools] failed to write:", err);
  }
}
