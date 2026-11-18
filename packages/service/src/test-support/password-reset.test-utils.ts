import { expect, vi } from "vitest";
import { z } from "zod";

import { authFetch, authPost, ORIGIN } from "./auth-requests.test-utils";

export const RESET_PAGE_PATH = "/app/reset-password";

const RESET_LINK = /https?:\/\/\S*\/api\/auth\/reset-password\/\S+/u;

const logLineSchema = z.string();

export const watchMailLog = () => {
  const log = vi.spyOn(console, "log");

  const lines = () =>
    log.mock.calls.flatMap(([line]) => {
      const text = logLineSchema.safeParse(line);

      return text.success ? [text.data] : [];
    });

  const links = () =>
    lines().flatMap((line) => {
      const link = RESET_LINK.exec(line)?.[0];

      return link === undefined ? [] : [link];
    });

  const latestLink = async () =>
    await vi.waitFor(() => {
      const link = links().at(-1);

      if (link === undefined) {
        throw new Error("no reset link logged yet");
      }

      return link;
    });

  return { latestLink, lines, links };
};

export const requestReset = async (email: string, redirectTo: string = RESET_PAGE_PATH) =>
  await authPost("/request-password-reset", { origin: ORIGIN }, { email, redirectTo });

export const mailedResetLink = async (email: string, redirectTo?: string) => {
  const mail = watchMailLog();

  try {
    const response = await requestReset(email, redirectTo);
    expect(response.status).toBe(200);

    return await mail.latestLink();
  } finally {
    vi.restoreAllMocks();
  }
};

export const followGetLeg = async (link: string) => {
  const { pathname, search } = new URL(link);
  const response = await authFetch(`${pathname.replace(/^\/api\/auth/u, "")}${search}`);
  expect(response.status).toBe(302);
  const location = response.headers.get("location");

  if (location === null) {
    throw new Error("GET leg did not redirect");
  }

  return new URL(location, ORIGIN) satisfies URL;
};

export const issueToken = async (email: string) => {
  const landing = await followGetLeg(await mailedResetLink(email));
  const token = landing.searchParams.get("token");

  if (token === null) {
    throw new Error("GET leg redirected without a token");
  }

  return token;
};
