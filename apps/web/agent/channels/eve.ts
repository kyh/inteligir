// WARNING: no development bypass, Vercel OIDC or shared secret here: a fallback would let a request skip the thread check
import { admitEveRequest, isSessionCreate } from "@repo/service/agent/eve-admission";
import type { AuthFn } from "eve/channels/auth";
import {
  extractBearerToken,
  ForbiddenError,
  UnauthenticatedError,
  withAuthChallenges,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { z } from "zod";

const createBody = z.object({ operationId: z.string() });

const operationIdOf = async (request: Request) => {
  try {
    const parsed = createBody.safeParse(await request.clone().json());

    return parsed.success ? parsed.data.operationId : null;
  } catch {
    return null;
  }
};

const appToken: AuthFn = withAuthChallenges(
  async (request) => {
    const { pathname } = new URL(request.url);

    const admission = await admitEveRequest({
      method: request.method,
      operationId: isSessionCreate(request.method, pathname) ? await operationIdOf(request) : null,
      pathname,
      token: extractBearerToken(request.headers.get("authorization")),
    });

    if (admission.ok) {
      return admission.principal;
    }

    if (admission.status === 401) {
      throw new UnauthenticatedError({ message: admission.message });
    }

    throw new ForbiddenError({ message: admission.message });
  },
  [{ scheme: "Bearer" }],
);

export default eveChannel({ auth: appToken });
