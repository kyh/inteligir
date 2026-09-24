// one line once the first index settle ends, so "is this boot slow, and where" has an answer: the
// wall time of each phase, and what the first reconcile found.

import type { ReconcileStats } from "./knowledge/knowledge-runtime";

export interface BootPhases {
  // the config, then the data dir claimed against a server already holding it
  claimMs: number;
  // the db and its migrations, the vault's repo and every service
  composeMs: number;
  listenMs: number;
  // the first settle, after listen: the index read back from its db, then reconciled
  indexMs: number;
}

const ms = (value: number): string => `${Math.round(value)}ms`;

export const bootReport = (phases: BootPhases, reconcile: ReconcileStats | null): string => {
  const total = phases.claimMs + phases.composeMs + phases.listenMs + phases.indexMs;
  const head = `[boot] ${ms(total)}: claim ${ms(phases.claimMs)}, compose ${ms(phases.composeMs)}, listen ${ms(phases.listenMs)}, index ${ms(phases.indexMs)}`;
  if (reconcile === null) {
    return `${head} (no reconcile finished)`;
  }
  return `${head} (listed ${reconcile.listed} files in ${ms(reconcile.listMs)}, read them in ${ms(reconcile.readMs)}: projected ${reconcile.projected}, unchanged ${reconcile.unchanged}, removed ${reconcile.removed}, deferred ${reconcile.deferred})`;
};
