import { base } from "../orpc";
import { CLI_SKILL_MD } from "../guide/cli-skill";

const status = base.system.status.handler(({ context }) => ({
  agent: context.system.agent,
  dataDir: context.system.dataDir,
  dataDirScope: context.system.dataDirScope,
  schemaVersion: context.system.schemaVersion,
  uptimeMs: Date.now() - context.system.startedAt,
  vaultDir: context.system.vaultDir,
  version: context.system.version,
}));

const guide = base.system.guide.handler(() => ({ markdown: CLI_SKILL_MD }));

const browserHandoff = base.system.browserHandoff.handler(({ context }) => ({
  nonce: context.browserSession.mintHandoff(),
}));

export const systemRouter = {
  browserHandoff,
  guide,
  status,
};
