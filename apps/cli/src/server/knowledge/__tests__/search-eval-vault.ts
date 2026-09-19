// notes are phrased the way a person writes them, not the way a query does —
// that gap is what is measured, so nothing here is tuned to make a query pass.
// thirty notes, so recall@10 and recall@∞ are not the same number.

export const EVAL_VAULT = {
  "health/burnout.md": `# Burnout

I have been exhausted lately and cannot focus on anything at work. Every small
task feels like wading through wet sand. Talked to Sam about taking a proper
break instead of another long weekend.
`,
  "health/dentist.md": `# Dentist

Cleaning every six months. The one on Mill Street takes evening appointments.
`,
  "health/running.md": `# Running

Three easy miles, one hard session, one long run. Shoes are done at about five
hundred miles.
`,
  "health/sleep.md": `# Sleep

Going to bed before eleven made the biggest difference. Caffeine after two in
the afternoon wrecks the whole night.
`,
  "journal/2026-02-02.md": `# Sunday

Long walk, no phone. First quiet day in weeks. I keep putting off the dentist.
`,
  "journal/2026-03-11.md": `# Wednesday

Wrote nothing worth keeping. Read two chapters and fell asleep on the sofa
before nine.
`,
  "money/mortgage.md": `# Mortgage

Fixed until 2029. Overpaying ten percent a year is allowed without a penalty.
`,
  "money/pension.md": `# Pension

Contributions raised to twelve percent. The old workplace pot is still sitting
in a default fund doing nothing.
`,
  "people/priya.md": `# Priya

Reviews faster than anyone and is blunt about it. Owns the gateway.
`,
  "people/sam.md": `# Sam

Met at the conference. Runs a small team, cares a lot about hiring slowly.
`,
  "projects/bike.md": `# Bike

New chain, new cassette. The bottom bracket creaks under load and I have been
ignoring it since March.
`,
  "projects/garden.md": `# Garden

Tomatoes go in after the last frost. The raised bed needs new soil this year.
`,
  "projects/house.md": `# House

The hall needs rewiring before anything else. Quotes came back three thousand
apart, which says more about the trade than the job.
`,
  "projects/knowledge-index.md": `# Knowledge index

The index is a cache: wipe and rebuild is always safe. Nothing durable lives
in it.
`,
  "projects/vault-search.md": `# Vault search design

Full-text search over the notes, ranked by bm25. The link graph answers
backlinks; the box answers words.
`,
  "reading/deep-work.md": `# Deep Work

Cal Newport. The argument is that concentration is a skill that atrophies.
Long uninterrupted blocks beat many short ones.
`,
  "reading/seeing-like-a-state.md": `# Seeing Like a State

Legibility is imposed for the convenience of the centre, and the local
knowledge it flattens is the part that made the thing work.
`,
  "recipes/bread.md": `# Sourdough bread

Feed the starter the night before. Bake at 240C with steam for the first
twenty minutes.
`,
  "recipes/roast-chicken.md": `# Roast chicken

Salt it the day before. Hot oven, breast down for the first half.
`,
  "recipes/soup.md": `# Lentil soup

Onion, carrot, celery, red lentils, stock. Simmer forty minutes.
`,
  "travel/lisbon.md": `# Lisbon

Stayed in Alfama. The tram is charming and useless. The best pastel de nata
was near the cathedral, not the famous one.
`,
  "travel/packing.md": `# Packing

One bag. Two shirts fewer than feels right. The charger is the thing I forget.
`,
  "work/billing.md": `# Billing

Invoices go out on the first. Dunning after fourteen days, then a hold.
`,
  "work/deploy-runbook.md": `# Deploy runbook

1. Tag the release.
2. Roll the canary and watch the error rate for ten minutes.
3. Promote to the full fleet.

Rollback is the same steps in reverse.
`,
  "work/hiring.md": `# Hiring

Screen for judgement, not trivia. Two interviewers per loop, written feedback
within a day.
`,
  "work/oncall.md": `# On-call notes

Paging comes through the gateway alert. If a release looks wrong, roll back
first and investigate afterwards. Nobody debugs a fire.
`,
  "work/one-on-ones.md": `# One-on-ones

Their agenda first, mine second. The useful question is what they are avoiding.
`,
  "work/postmortem-2026-01.md": `# Postmortem

The alert fired for nine minutes before anyone looked. Nothing was wrong with
the code; the dashboard was pointed at the old cluster.
`,
  "work/roadmap.md": `# Roadmap

Three bets this half: the gateway rewrite, billing, and the mobile shell.
Everything else is maintenance.
`,
  "work/standup-2026-03-10.md": `# Standup

Blocked on the gateway migration. Asked Priya to review the runbook changes
before Thursday.
`,
};

export interface EvalQuery {
  query: string;
  gold: readonly string[];
}

export const EVAL_QUERIES: readonly EvalQuery[] = [
  // the sentence a lexical fix recovers, and the one it cannot.
  { gold: ["health/burnout.md"], query: "how do I stop feeling burnt out at work" },
  { gold: ["health/burnout.md"], query: "what did I write about being tired" },

  // short lookups: must not regress.
  { gold: ["work/deploy-runbook.md"], query: "deploy runbook" },
  { gold: ["work/deploy-runbook.md"], query: "canary release" },
  { gold: ["projects/vault-search.md"], query: "bm25 ranking" },
  { gold: ["work/standup-2026-03-10.md"], query: "gateway migration" },
  { gold: ["recipes/bread.md"], query: "sourdough" },
  { gold: ["health/dentist.md", "journal/2026-02-02.md"], query: "dentist" },

  // one inflected word: the case a prefix alone cannot answer.
  { gold: ["health/dentist.md", "journal/2026-02-02.md"], query: "dentists" },
  { gold: ["work/hiring.md"], query: "interviewer" },
  { gold: ["work/billing.md"], query: "invoicing" },

  // content words present in the note.
  { gold: ["work/oncall.md"], query: "how do I roll back a bad release" },
  { gold: ["recipes/bread.md"], query: "what temperature do I bake the bread at" },
  { gold: ["recipes/soup.md"], query: "how long do I simmer the lentils" },
  { gold: ["money/mortgage.md"], query: "can I overpay the mortgage without a penalty" },
  { gold: ["projects/garden.md"], query: "when do I plant the tomatoes" },
  { gold: ["reading/deep-work.md"], query: "what is the book about concentration" },
  { gold: ["people/priya.md"], query: "who reviews the gateway changes" },
  { gold: ["projects/knowledge-index.md"], query: "why is the knowledge index safe to delete" },
  {
    gold: ["work/postmortem-2026-01.md"],
    query: "what did the postmortem say about the dashboard",
  },
  { gold: ["projects/house.md"], query: "how much are the quotes for rewiring the hall" },
  { gold: ["work/hiring.md"], query: "notes about hiring people" },
  { gold: ["journal/2026-02-02.md"], query: "what happened on the quiet sunday" },

  // words the note does not use: the residue this measures.
  { gold: ["recipes/bread.md", "recipes/soup.md"], query: "what should I cook tonight" },
  { gold: ["work/hiring.md"], query: "notes on interviewing candidates" },
  { gold: ["work/oncall.md"], query: "what do I do when the site goes down" },
  { gold: ["health/sleep.md"], query: "I cannot sleep because of coffee" },
  { gold: ["health/burnout.md"], query: "feeling drained and unable to concentrate" },
  { gold: ["projects/bike.md"], query: "which bicycle parts need replacing" },
  { gold: ["money/pension.md"], query: "what am I saving for retirement" },
  { gold: ["travel/lisbon.md"], query: "trip to portugal" },
];
