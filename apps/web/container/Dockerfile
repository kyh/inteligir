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
#
# BuildKit is required, and is what every caller already uses: wrangler builds
# this with `--load --provenance=false`, which the classic builder does not
# understand.

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo

# pnpm's content-addressable store, on a build cache rather than inside a layer.
# Both pnpm steps below resolve through it, so a lockfile change re-downloads
# only what the store does not already hold. `npm_config_*` is how pnpm takes a
# setting from the environment.
ENV npm_config_store_dir=/pnpm-store

# MANIFESTS FIRST, sources second, and that order is the whole point: the
# install layer is keyed on what the install actually reads, so editing a source
# file re-bundles the daemon and nothing else. A `COPY . .` above this line puts
# a full workspace resolve — ~1,700 packages, minutes — behind every such edit.
#
# pnpm resolves the WHOLE workspace, so every member's manifest belongs here and
# not just this package's. A member whose manifest is missing is NOT refused:
# the install succeeds, leaves a dangling `node_modules` symlink where that
# package should be, and fails at runtime. `agent-image.test.ts` in
# tools/repo-guards is what keeps this list level with pnpm-workspace.yaml.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
COPY apps/web/container/package.json apps/web/container/
COPY packages/bridge/package.json packages/bridge/
COPY packages/editor/package.json packages/editor/
COPY packages/notes/package.json packages/notes/
COPY packages/ui/package.json packages/ui/
COPY packages/workspace/package.json packages/workspace/
COPY tools/repo-guards/package.json tools/repo-guards/
# Frozen is the point of copying the lockfile in: the image installs what the
# repo resolved, not what the registry offers on the day it is built.
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile

COPY . .
# Bundle BEFORE deploying. `pnpm deploy` copies the package as it stands on
# disk, so dist/main.js has to already exist.
RUN pnpm --filter @repo/agent-container build:container
# `--legacy` is required, not habit: from pnpm 10 a deploy without it refuses
# any workspace that does not inject its workspace dependencies
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), which is this one.
#
# The store mount is repeated because deploy resolves the deployed package's
# dependencies through it too — without it this step refetches them whenever the
# install above came from the layer cache.
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    pnpm deploy --legacy --filter @repo/agent-container --prod /out

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
