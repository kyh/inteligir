// No development bypass, Vercel OIDC or shared secret: the app is the only client, and a fallback
// would let a request skip the thread check. /eve/v1/health needs no token.
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

// read from a clone, so eve still reads the body
const operationIdOf = async (request: Request): Promise<string | null> => {
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
