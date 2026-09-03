import { describeCloudFailure } from "@repo/api/cloud/client";
import { isDeviceLoginRefusal } from "@repo/api/cloud/device/device-schema";
import { base } from "../orpc";

const status = base.cloud.status.handler(({ context }) => context.cloud.status());

// each of the cloud's own refusals keeps its class; anything else — unreachable, a body this
// build cannot read, a code the login route never answers — is the cloud being unavailable
const login = base.cloud.login.handler(async ({ context, input, errors }) => {
  const outcome = await context.cloud.login(input);
  if (outcome.kind === "logged-in") {
    return outcome.status;
  }
  const { failure } = outcome;
  if (failure.kind === "refused" && isDeviceLoginRefusal(failure.code)) {
    const message = failure.message;
    switch (failure.code) {
      case "invalid-credentials":
        throw errors.UNAUTHORIZED({ message });
      case "device-limit":
        throw errors.CONFLICT({ message });
      case "rate-limited":
        throw errors.TOO_MANY_REQUESTS({ message });
    }
  }
  throw errors.PROVIDER_UNAVAILABLE({ message: describeCloudFailure(failure) });
});

const logout = base.cloud.logout.handler(({ context }) => context.cloud.logout());

const syncNow = base.cloud.syncNow.handler(({ context }) => context.cloud.syncNow());

export const cloudRouter = {
  status,
  login,
  logout,
  syncNow,
};
