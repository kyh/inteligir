// The labelled corpus the search evaluation runs over (search-eval.test.ts).
//
// Notes are written the way a person writes notes — not the way a query
// phrases them — because that gap IS the thing being measured. Nothing here
// was adjusted to make a query pass; a query that misses is the finding.
//
// Thirty notes rather than a handful, deliberately: a corpus smaller than the
// result window makes recall@10 and recall@∞ the same number, and then the
// harness cannot tell "the engine never retrieved it" from "the engine ranked
// it twelfth" — which is the difference between what an embedding buys and
// what a reranker buys.

export const EVAL_VAULT: Readonly<Record<string, string>> = {
  "health/burnout.md": `# Burnout

I have been exhausted lately and cannot focus on anything at work. Every small
task feels like wading through wet sand. Talked to Sam about taking a proper
break instead of another long weekend.
`,
  "health/sleep.md": `# Sleep

Going to bed before eleven made the biggest difference. Caffeine after two in
the afternoon wrecks the whole night.
`,
  "health/running.md": `# Running

Three easy miles, one hard session, one long run. Shoes are done at about five
hundred miles.
`,
  "health/dentist.md": `# Dentist

Cleaning every six months. The one on Mill Street takes evening appointments.
`,
  "work/deploy-runbook.md": `# Deploy runbook

1. Tag the release.
2. Roll the canary and watch the error rate for ten minutes.
3. Promote to the full fleet.

Rollback is the same steps in reverse.
`,
  "work/oncall.md": `# On-call notes

Paging comes through the gateway alert. If a release looks wrong, roll back
first and investigate afterwards. Nobody debugs a fire.
`,
  "work/standup-2026-03-10.md": `# Standup

Blocked on the gateway migration. Asked Priya to review the runbook changes
before Thursday.
`,
  "work/hiring.md": `# Hiring

Screen for judgement, not trivia. Two interviewers per loop, written feedback
within a day.
`,
  "work/one-on-ones.md": `# One-on-ones

Their agenda first, mine second. The useful question is what they are avoiding.
`,
  "work/roadmap.md": `# Roadmap

Three bets this half: the gateway rewrite, billing, and the mobile shell.
Everything else is maintenance.
`,
  "work/billing.md": `# Billing

Invoices go out on the first. Dunning after fourteen days, then a hold.
`,
  "work/postmortem-2026-01.md": `# Postmortem

The alert fired for nine minutes before anyone looked. Nothing was wrong with
the code; the dashboard was pointed at the old cluster.
`,
  "projects/vault-search.md": `# Vault search design

Full-text search over the notes, ranked by bm25. The link graph answers
backlinks; the box answers words.
`,
  "projects/knowledge-index.md": `# Knowledge index

The index is a cache: wipe and rebuild is always safe. Nothing durable lives
in it.
`,
  "projects/garden.md": `# Garden

Tomatoes go in after the last frost. The raised bed needs new soil this year.
`,
  "projects/bike.md": `# Bike

New chain, new cassette. The bottom bracket creaks under load and I have been
ignoring it since March.
`,
  "projects/house.md": `# House

The hall needs rewiring before anything else. Quotes came back three thousand
apart, which says more about the trade than the job.
`,
  "recipes/bread.md": `# Sourdough bread

Feed the starter the night before. Bake at 240C with steam for the first
twenty minutes.
`,
  "recipes/soup.md": `# Lentil soup

Onion, carrot, celery, red lentils, stock. Simmer forty minutes.
`,
  "recipes/roast-chicken.md": `# Roast chicken

Salt it the day before. Hot oven, breast down for the first half.
`,
  "travel/lisbon.md": `# Lisbon

Stayed in Alfama. The tram is charming and useless. The best pastel de nata
was near the cathedral, not the famous one.
`,
  "travel/packing.md": `# Packing

One bag. Two shirts fewer than feels right. The charger is the thing I forget.
`,
  "money/mortgage.md": `# Mortgage

Fixed until 2029. Overpaying ten percent a year is allowed without a penalty.
`,
  "money/pension.md": `# Pension

Contributions raised to twelve percent. The old workplace pot is still sitting
in a default fund doing nothing.
`,
  "reading/deep-work.md": `# Deep Work

Cal Newport. The argument is that concentration is a skill that atrophies.
Long uninterrupted blocks beat many short ones.
`,
  "reading/seeing-like-a-state.md": `# Seeing Like a State

Legibility is imposed for the convenience of the centre, and the local
knowledge it flattens is the part that made the thing work.
`,
  "people/sam.md": `# Sam

Met at the conference. Runs a small team, cares a lot about hiring slowly.
`,
  "people/priya.md": `# Priya

Reviews faster than anyone and is blunt about it. Owns the gateway.
`,
  "journal/2026-02-02.md": `# Sunday

Long walk, no phone. First quiet day in weeks. I keep putting off the dentist.
`,
  "journal/2026-03-11.md": `# Wednesday

Wrote nothing worth keeping. Read two chapters and fell asleep on the sofa
before nine.
`,
};

/** One labelled query: what a person would type, and the notes they meant. */
export type EvalQuery = {
  query: string;
  /** Every note that would be a correct answer, unordered. */
  gold: readonly string[];
};

export const EVAL_QUERIES: readonly EvalQuery[] = [
  // The plan's own two probes come first: the sentence a lexical fix recovers,
  // and the one it provably cannot.
  { query: "how do I stop feeling burnt out at work", gold: ["health/burnout.md"] },
  { query: "what did I write about being tired", gold: ["health/burnout.md"] },

  // Short lookups — the case that must not regress.
  { query: "deploy runbook", gold: ["work/deploy-runbook.md"] },
  { query: "canary release", gold: ["work/deploy-runbook.md"] },
  { query: "bm25 ranking", gold: ["projects/vault-search.md"] },
  { query: "gateway migration", gold: ["work/standup-2026-03-10.md"] },
  { query: "sourdough", gold: ["recipes/bread.md"] },
  { query: "dentist", gold: ["health/dentist.md", "journal/2026-02-02.md"] },

  // Sentences whose content words are present somewhere in the note.
  { query: "how do I roll back a bad release", gold: ["work/oncall.md"] },
  { query: "what temperature do I bake the bread at", gold: ["recipes/bread.md"] },
  { query: "how long do I simmer the lentils", gold: ["recipes/soup.md"] },
  { query: "can I overpay the mortgage without a penalty", gold: ["money/mortgage.md"] },
  { query: "when do I plant the tomatoes", gold: ["projects/garden.md"] },
  { query: "what is the book about concentration", gold: ["reading/deep-work.md"] },
  { query: "who reviews the gateway changes", gold: ["people/priya.md"] },
  { query: "why is the knowledge index safe to delete", gold: ["projects/knowledge-index.md"] },
  {
    query: "what did the postmortem say about the dashboard",
    gold: ["work/postmortem-2026-01.md"],
  },
  { query: "how much are the quotes for rewiring the hall", gold: ["projects/house.md"] },
  { query: "notes about hiring people", gold: ["work/hiring.md"] },
  { query: "what happened on the quiet sunday", gold: ["journal/2026-02-02.md"] },

  // Sentences whose words the note does not use — the residue this measures.
  { query: "what should I cook tonight", gold: ["recipes/bread.md", "recipes/soup.md"] },
  { query: "notes on interviewing candidates", gold: ["work/hiring.md"] },
  { query: "what do I do when the site goes down", gold: ["work/oncall.md"] },
  { query: "I cannot sleep because of coffee", gold: ["health/sleep.md"] },
  { query: "feeling drained and unable to concentrate", gold: ["health/burnout.md"] },
  { query: "which bicycle parts need replacing", gold: ["projects/bike.md"] },
  { query: "what am I saving for retirement", gold: ["money/pension.md"] },
  { query: "trip to portugal", gold: ["travel/lisbon.md"] },
];
