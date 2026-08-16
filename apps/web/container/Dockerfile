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

# pnpm's two caches, on build caches rather than inside a layer, because they
# hold DIFFERENT things and only mounting one leaves the other cold. The store
# is package CONTENT, so a lockfile change re-downloads only what it does not
# already hold. The cache dir is registry METADATA, and that is the one the
# deploy below lives or dies on: `pnpm deploy` re-resolves the whole workspace,
# not the package it deploys, so without this it refetches metadata for every
# package in the lockfile on every build — a step that reads a package.json and
# copies files otherwise spends minutes on the network. `npm_config_*` is how
# pnpm takes a setting from the environment.
ENV npm_config_store_dir=/pnpm-store npm_config_cache_dir=/pnpm-cache

# MANIFESTS FIRST, sources second, and that order is the whole point: the
# install layer is keyed on what the install actually reads, so editing a source
# file re-bundles the daemon and nothing else. A `COPY . .` above this line puts
# a full workspace resolve behind every such edit.
#
# The install is FILTERED to this one package, and that is what makes it small.
# The daemon depends on no workspace package — the dependency direction runs the
# other way, `apps/web/src/worker/*` imports FROM it — so the ~380 packages the
# filter resolves are a fraction of the workspace's ~1,700, and only the
# manifests it resolves belong above the install. The root's own manifest is not
# optional: pnpm installs the workspace root whatever the filter selects, and
# without it a frozen install refuses outright on the `overrides` it declares.
#
# pnpm refuses NEITHER shape of a missing manifest, and both exit 0: a filter
# matching nothing installs nothing at all, and a workspace dependency whose
# manifest is absent installs as a dangling `node_modules` symlink. Which step
# then reads the gap first — the bundle, the deploy, or the daemon on a wake —
# is left to luck, and none of them name the COPY line that is missing.
# `agent-image.test.ts` in tools/repo-guards derives this list from the filter
# below rather than trusting it.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/container/package.json apps/web/container/
# Frozen is the point of copying the lockfile in: the image installs what the
# repo resolved, not what the registry offers on the day it is built.
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    --mount=type=cache,target=/pnpm-cache,sharing=locked \
    pnpm install --frozen-lockfile --filter @repo/agent-container...

COPY . .
# Bundle BEFORE deploying. `pnpm deploy` copies the package as it stands on
# disk, so dist/main.js has to already exist.
RUN pnpm --filter @repo/agent-container build:container
# `--legacy` is required, not habit: from pnpm 10 a deploy without it refuses
# any workspace that does not inject its workspace dependencies
# (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE), which is this one.
#
# Both mounts are repeated because deploy resolves through both, and it is the
# step that needs them most: it re-resolves the ENTIRE lockfile — every package
# in the workspace, not the deployed package's own subgraph — before copying a
# single file. `--frozen-lockfile` does not narrow that; it is accepted and
# ignored here. So the metadata cache is what keeps a source edit costing
# seconds instead of the whole resolve again.
RUN --mount=type=cache,target=/pnpm-store,sharing=locked \
    --mount=type=cache,target=/pnpm-cache,sharing=locked \
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
