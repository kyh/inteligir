---
id: f2745aa0-f394-4469-963d-438f2dd9fd5a
description: Five workflows to try inteligir on real work.
tags:
  - guide
status: reference
---

# Use Cases

Five shapes of work that fit a vault with an agent in it. Each one says what to make, where to start, and what to hand to the agent.

For the mechanics of any construct mentioned here, see [[Getting Started|a618c388-0d20-4ebe-bcbd-55b9d59094ec]].

```inteligir-callout
info
Two ways to reach an agent, and they share the same vault. `⌘K` runs an action inside the app, attached to the note you are reading. A coding agent in your terminal edits the same files directly — the vault is a git repo, so both are just writing markdown.
```

---

## Product Specs

A spec is worth writing here when the argument and the artifact belong together.

**Start with** the problem, who it is for, the goals and non-goals, and the open questions you already know about.

**Ask the agent:**

> Turn these notes into a spec: goals, non-goals, user stories, acceptance\
> criteria. Leave a comment wherever a requirement is ambiguous rather than\
> guessing.

**Then add** a checklist for readiness, a table for requirements and owners, an `/html` block when a behaviour is easier to click than to describe, and tabs when one spec covers several states.

**Hand off** by pointing your coding agent at the note. It reads the acceptance criteria, implements against them, and answers your comments in place.

---

## Research

Research goes stale when the findings and the evidence drift apart. Keep them in one note and link outward.

**Start with** a question stated in one sentence, then collect sources as you go.

**Ask the agent:**

> Read the linked notes and summarise where they agree and where they conflict.\
> Put the conflicts in a table with the source for each side.

**Then add** wiki links to every source note — the **Related** panel starts surfacing connections you did not make deliberately — and a chart when a number moves over time.

**Hand off** when the research turns into a decision: ask for a memo that leads with the recommendation.

---

## Decisions

A decision note earns its keep months later, when someone asks why.

**Start with** the decision itself in the first paragraph. Options and tradeoffs come after.

**Ask the agent:**

> Draft the tradeoff table for these options, then argue the strongest case\
> against the one I picked.

**Then add** a priority callout for what happens if the decision is wrong, and formula pills for the numbers that drove it — named, so a changed assumption moves everything downstream.

**Hand off** the note as context whenever the implementation raises the question again.

---

## Docs That Track Code

Documentation rots when it lives away from the thing it describes. A vault in a repo does not have that problem.

**Start with** one note per subsystem: what it does, what it owns, what it refuses to do.

**Ask the agent:**

> Read the module and update this note to match. Comment on anything the code\
> does that the note does not explain.

**Then add** ASCII diagrams in plain fences (they diff cleanly), tables for configuration, and links between subsystem notes.

**Hand off** continuously — a coding agent that just changed a module can update its note in the same turn.

---

## Release Review

**Start with** what is shipping, what is risky, and what the rollback is.

**Ask the agent:**

> Review this against the linked spec and comment on anything that changed\
> without being written down.

**Then add** a checklist for the gates, a chart for whatever you are watching after the release, and a warning callout for the failure you would most regret forgetting.

**Hand off** the note as the running record: reviewers answer comments, and the resolved threads become the history of what was checked.

---

## Combining Them

These are not separate modes. Research becomes a decision, the decision becomes a spec, the spec becomes docs, and the links between them are what make the vault worth more than the sum of its notes. Start one note, link the next, and let **Related** show you the shape you have been building.
