// `/v1/exports/<id>`: an export the library wrote (`./cell-exports`), downloaded as a zip behind
// the Worker's own credential check, as a file is (`./blob-routes`): only the account's own
// export is reachable, since its key is read from the account the credential verified, never from
// the request, and R2 answers a range, so a download that broke resumes. An export not yet
// written, or let go after its seven days, is not there.

import { V1_EXPORTS_PATH } from "@repo/contract/cloud/library/library-blobs";
import { z } from "zod";

import { isBelowFloor } from "../client-floor";
import { createDb } from "../db/client";
import { spendDeviceBudget } from "../rate-limit";
import { holderIdOf, lazyPrincipal } from "../wire/v1-principal";
import { readObject, text } from "./blob-routes";
import { exportKey } from "./cell-exports";

const EXPORT_PATH = /^\/v1\/exports\/(?<id>[^/]+)$/u;

const exportIdSchema = z.uuid();

export const isExportPath = (pathname: string): boolean =>
  pathname.startsWith(`${V1_EXPORTS_PATH}/`);

const MISSING = "That export isn't ready, or it was let go seven days after it was written.";

// the name a download is saved under: the library, and the day the zip was written
const savedName = (uploaded: string | null): string => {
  const day = uploaded === null ? null : new Date(uploaded);
  return day === null || Number.isNaN(day.getTime())
    ? "Library.zip"
    : `Library ${day.toISOString().slice(0, 10)}.zip`;
};

export const handleExportRoute = async (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> => {
  if (isBelowFloor(request, env)) {
    return text(426, "This version of the app is too old. Update it to keep going.");
  }
  const id = exportIdSchema.safeParse(EXPORT_PATH.exec(url.pathname)?.groups?.["id"]);
  if (!id.success) {
    return text(404, "An export is named by the id its start answered.");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return text(405, "An export is read.", { allow: "GET, HEAD" });
  }
  const principal = await lazyPrincipal(request, env, ctx)();
  if (principal === null) {
    return text(401, "You're signed out. Sign in again.");
  }
  if (!(await spendDeviceBudget(env, createDb(env.DB), "blobs", holderIdOf(principal)))) {
    return text(429, "Too many requests. Try again in a minute.");
  }
  const response = await readObject(
    request,
    env.BLOBS,
    exportKey(principal.accountId, id.data),
    MISSING,
  );
  if (response.status < 300) {
    response.headers.set(
      "content-disposition",
      `attachment; filename="${savedName(response.headers.get("last-modified"))}"`,
    );
  }
  return response;
};
