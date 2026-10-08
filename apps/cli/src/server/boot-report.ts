// one line once the server listens, so "is this boot slow, and where" has an answer: the wall time
// of each phase.

export interface BootPhases {
  // the config, then the data dir claimed against a server already holding it
  claimMs: number;
  // the db and its migrations, and every service
  composeMs: number;
  listenMs: number;
}

const ms = (value: number): string => `${Math.round(value)}ms`;

export const bootReport = (phases: BootPhases): string => {
  const total = phases.claimMs + phases.composeMs + phases.listenMs;
  return `[boot] ${ms(total)}: claim ${ms(phases.claimMs)}, compose ${ms(phases.composeMs)}, listen ${ms(phases.listenMs)}`;
};
