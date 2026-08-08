// The skills table (jsdom). What matters here is what the previous listing
// could not say: a budget state that kept the agent from seeing a skill is
// visible and explained, "no skills" and "couldn't read skills" are different
// states, and a rejected create shows the host's own sentence.
// Runs the real section over the dev-harness fixture Bridge, with the one
// method under test overridden per case.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// No vitest globals in this repo, so testing-library can't auto-cleanup.
afterEach(cleanup);

import type { Bridge } from "@repo/bridge/ipc-contract";
import type { SkillInfo } from "@repo/bridge/skills";
import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { createFixtureBridge } from "@repo/workspace/dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "@repo/workspace/dev/wasm-sql-driver";
import { installBridge } from "@repo/bridge/client";
import { SkillsSection } from "./skills-section";

const sqlite3 = await loadSqlite3();
const newBridge = (): Bridge =>
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root));

function renderSection(bridge: Bridge) {
  installBridge(bridge);
  return render(<SkillsSection />);
}

const LOADED_SKILL: SkillInfo = {
  name: "weekly-review",
  description: "Draft the weekly review.",
  scope: "user",
  filePath: "/skills/weekly-review/SKILL.md",
  source: "added",
  updatedAt: Date.parse("2026-07-24T10:00:00.000Z"),
  budget: { kind: "loaded" },
};

describe("skills table", () => {
  it("renders one row per skill with its source, and no badge when it loaded whole", async () => {
    renderSection({ ...newBridge(), listSkills: async () => ({ skills: [LOADED_SKILL] }) });

    const row = await screen.findByRole("button", { name: /weekly-review/ });
    expect(row.textContent).toBe("weekly-review");
    expect(screen.getByRole("columnheader", { name: "Skill" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Added" })).toBeTruthy();
  });

  it("renders an em dash when the file's mtime is unreadable", async () => {
    renderSection({
      ...newBridge(),
      listSkills: async () => ({ skills: [{ ...LOADED_SKILL, updatedAt: null }] }),
    });

    await screen.findByRole("button", { name: /weekly-review/ });
    expect(screen.getByRole("cell", { name: "—" })).toBeTruthy();
  });

  it("badges a trimmed description and explains the loss when the row expands", async () => {
    renderSection({
      ...newBridge(),
      listSkills: async () => ({
        skills: [
          {
            ...LOADED_SKILL,
            budget: { kind: "description-trimmed", promptChars: 24, originalChars: 2400 },
          },
        ],
      }),
    });

    const toggle = await screen.findByRole("button", { name: /weekly-review/ });
    expect(toggle.textContent).toContain("shortened");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
    expect(screen.getByText(/received 24 of this description's 2400 characters/)).toBeTruthy();
    expect(screen.getByText("Draft the weekly review.")).toBeTruthy();
  });

  it("badges a skill the agent never received and says it cannot be invoked", async () => {
    renderSection({
      ...newBridge(),
      listSkills: async () => ({
        skills: [{ ...LOADED_SKILL, budget: { kind: "not-loaded", reason: "skill-count" } }],
      }),
    });

    const toggle = await screen.findByRole("button", { name: /weekly-review/ });
    expect(toggle.textContent).toContain("not loaded");

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(/cannot invoke it/)).toBeTruthy());
  });

  it("shows the empty state when there are no skills", async () => {
    renderSection({ ...newBridge(), listSkills: async () => ({ skills: [] }) });

    await screen.findByText(/No skills yet\./);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a failed read as an error rather than as an empty vault", async () => {
    renderSection({
      ...newBridge(),
      listSkills: () => Promise.reject(new Error("skills folder unreadable")),
    });

    await screen.findByText("skills folder unreadable");
    expect(screen.queryByText(/No skills yet\./)).toBeNull();
  });
});

describe("adding a skill", () => {
  it("surfaces the host's rejection sentence verbatim", async () => {
    renderSection({
      ...newBridge(),
      listSkills: async () => ({ skills: [LOADED_SKILL] }),
      createSkill: () => Promise.reject(new Error('A skill named "weekly-review" already exists.')),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Add skill…" }));
    fireEvent.change(screen.getByPlaceholderText("Weekly review"), {
      target: { value: "Weekly Review" },
    });
    fireEvent.change(screen.getByPlaceholderText("When the agent should reach for this skill."), {
      target: { value: "Draft the weekly review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await screen.findByText('A skill named "weekly-review" already exists.');
  });

  it("re-renders from the returned listing and reports the slug the host chose", async () => {
    const created: SkillInfo = { ...LOADED_SKILL, name: "weekly-review" };
    renderSection({
      ...newBridge(),
      listSkills: async () => ({ skills: [] }),
      createSkill: async () => ({ skill: created, skills: [created] }),
    });

    await screen.findByText(/No skills yet\./);
    fireEvent.click(screen.getByRole("button", { name: "Add skill…" }));
    fireEvent.change(screen.getByPlaceholderText("Weekly review"), {
      target: { value: "Weekly Review" },
    });
    fireEvent.change(screen.getByPlaceholderText("When the agent should reach for this skill."), {
      target: { value: "Draft the weekly review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await screen.findByRole("table");
    // The host slugifies, so the confirmation quotes what came back, never the
    // "Weekly Review" that was typed.
    expect(screen.getByText(/Created/).textContent).toContain("weekly-review");
  });

  it("refuses an empty description before it reaches the host", async () => {
    renderSection({
      ...newBridge(),
      listSkills: async () => ({ skills: [] }),
      createSkill: () => Promise.reject(new Error("the host should not have been called")),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Add skill…" }));
    fireEvent.change(screen.getByPlaceholderText("Weekly review"), {
      target: { value: "Weekly Review" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await screen.findByText("A name and a description are both required.");
  });
});
