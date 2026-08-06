# The agent image: the pi coding agent plus the daemon that drives it, as one
# node process inside a per-user Cloudflare Sandbox.
#
# THE BUILD CONTEXT IS THE REPO ROOT, not this directory:
#
#     docker build -f apps/web/container/Dockerfile -t inteligir-agent .
#
# The daemon is a pnpm WORKSPACE package: its versions come from the root
# lockfile and the catalog, neither of which lives in this folder. A context of
# this folder alone resolves nothing.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Frozen is the point of copying the lockfile in: the image installs what the
# repo resolved, not what the registry offers on the day it is built.
RUN pnpm install --frozen-lockfile
# Bundle BEFORE deploying. `pnpm deploy` copies the package as it stands on
# disk, so dist/main.js has to already exist.
RUN pnpm --filter @repo/agent-container build:container
# `--legacy` is required, not habit: from pnpm 10 a deploy without it refuses
# any workspace that does not inject its workspace dependencies
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), which is this one.
RUN pnpm deploy --legacy --filter @repo/agent-container --prod /out

# The base image IS the sandbox — it ships the control server the Worker's
# `Sandbox` binding talks to, and that server is this image's entrypoint.
# DO NOT add a CMD or ENTRYPOINT: the daemon is not the main process. The
# Worker starts it per boot with `startProcess("node /app/dist/main.js")` under
# a fixed process id, which is what lets a wake reattach to a daemon that is
# already running instead of binding its port twice.
FROM docker.io/cloudflare/sandbox:0.12.4

COPY --from=build /out /app

# `/workspace` is the daemon's cwd, so `./vault` resolves to /workspace/vault —
# the path every tool description names. `/agent` holds pi's own state and is
# kept OUT of the workspace, so the model does not list, read and reason about
# pi's settings as though they were the user's notes.
RUN mkdir -p /workspace/vault /agent
