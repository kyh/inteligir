import { base } from "../orpc";
import { CLI_SKILL_MD } from "../guide/cli-skill";

const status = base.system.status.handler(({ context }) => ({
  agent: context.system.agent(),
  dataDir: context.system.dataDir,
  dataDirScope: context.system.dataDirScope,
  schemaVersion: context.system.schemaVersion,
  uptimeMs: Date.now() - context.system.startedAt,
  vaultDir: context.system.vaultDir,
  version: context.system.version,
}));

const guide = base.system.guide.handler(() => ({ markdown: CLI_SKILL_MD }));

const browserHandoff = base.system.browserHandoff.handler(({ context, errors }) => {
  if (!context.system.servesUi) {
    throw errors.NOT_FOUND({
      message:
        "This server serves no UI (an unbuilt checkout): run `pnpm build`, or open the desktop app.",
    });
  }
  return { nonce: context.browserSession.mintHandoff() };
});

export const systemRouter = {
  browserHandoff,
  guide,
  status,
};
