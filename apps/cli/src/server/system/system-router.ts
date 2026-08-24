// The system handlers: what this instance IS, and the manual it serves.
//
// Both answer from values resolved at boot — `context.system` is a snapshot,
// so `uptimeMs` is the one field computed per call.

import { base } from "../orpc";
import { CLI_SKILL_MD } from "../guide/cli-skill";

const status = base.system.status.handler(({ context }) => ({
  version: context.system.version,
  dataDir: context.system.dataDir,
  vaultDir: context.system.vaultDir,
  schemaVersion: context.system.schemaVersion,
  uptimeMs: Date.now() - context.system.startedAt,
  agent: context.system.agent,
}));

const guide = base.system.guide.handler(() => ({ markdown: CLI_SKILL_MD }));

export const systemRouter = {
  status,
  guide,
};
