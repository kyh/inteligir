// A password reset as the site asks for one, its mail caught where the suites' EMAIL_MODE (unset,
// so log; ../auth/send-email.ts) writes it: the server's log. Better Auth sends it after the answer,
// so a test waits for the line rather than for the request.

import { expect, vi } from "vitest";
import { z } from "zod";

import { authFetch, authPost, ORIGIN } from "./auth-requests";

// the site's /app/reset-password route, which the forgot-password page names as its redirectTo
export const RESET_PAGE_PATH = "/app/reset-password";

const RESET_LINK = /https?:\/\/\S*\/api\/auth\/reset-password\/\S+/u;

const logLineSchema = z.string();

// The server's log from here on, held quiet; the caller restores it (`vi.restoreAllMocks`).
export const watchMailLog = () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {
    // quiet: the test reads the lines off the spy
  });
  const lines = (): string[] =>
    log.mock.calls.flatMap(([line]) => {
      const text = logLineSchema.safeParse(line);
      return text.success ? [text.data] : [];
    });
  const links = (): string[] =>
    lines().flatMap((line) => {
      const link = RESET_LINK.exec(line)?.[0];
      return link === undefined ? [] : [link];
    });
  // the latest reset link, waited for: the mail goes after the answer
  const latestLink = async (): Promise<string> =>
    await vi.waitFor(() => {
      const link = links().at(-1);
      if (link === undefined) {
        throw new Error("no reset link logged yet");
      }
      return link;
    });
  return { latestLink, lines, links };
};

export const requestReset = async (
  email: string,
  redirectTo: string = RESET_PAGE_PATH,
): Promise<Response> =>
  await authPost("/request-password-reset", { origin: ORIGIN }, { email, redirectTo });

// the link a reset for `email` mailed
export const mailedResetLink = async (email: string, redirectTo?: string): Promise<string> => {
  const mail = watchMailLog();
  try {
    const response = await requestReset(email, redirectTo);
    expect(response.status).toBe(200);
    return await mail.latestLink();
  } finally {
    vi.restoreAllMocks();
  }
};

// the mailed link's GET leg, which Better Auth answers with a redirect to the page it named
export const followGetLeg = async (link: string): Promise<URL> => {
  const { pathname, search } = new URL(link);
  const response = await authFetch(`${pathname.replace(/^\/api\/auth/u, "")}${search}`);
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  if (location === null) {
    throw new Error("GET leg did not redirect");
  }
  return new URL(location, ORIGIN);
};

export const issueToken = async (email: string): Promise<string> => {
  const landing = await followGetLeg(await mailedResetLink(email));
  const token = landing.searchParams.get("token");
  if (token === null) {
    throw new Error("GET leg redirected without a token");
  }
  return token;
};
