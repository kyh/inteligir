import { base } from "../orpc";

const status = base.system.status.handler(({ context }) => ({
  agent: context.system.agent(),
  dataDir: context.system.dataDir,
  schemaVersion: context.system.schemaVersion,
  uptimeMs: Date.now() - context.system.startedAt,
  version: context.system.version,
}));

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
  status,
};
