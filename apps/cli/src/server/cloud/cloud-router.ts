import { describeCloudFailure } from "@repo/api/cloud/client";
import { isDeviceLoginRefusal, isDeviceSignUpRefusal } from "@repo/api/cloud/device/device-schema";
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
    const { message } = failure;
    switch (failure.code) {
      case "invalid-credentials": {
        throw errors.UNAUTHORIZED({ message });
      }
      case "device-limit": {
        throw errors.CONFLICT({ message });
      }
      case "rate-limited": {
        throw errors.TOO_MANY_REQUESTS({ message });
      }
      default: {
        const unanswered: never = failure.code;
        return unanswered;
      }
    }
  }
  throw errors.PROVIDER_UNAVAILABLE({ message: describeCloudFailure(failure) });
});

// login's rule: the sign-up route's own refusals keep their class, and the rest is unavailable
const signUp = base.cloud.signUp.handler(async ({ context, input, errors }) => {
  const outcome = await context.cloud.signUp(input);
  if (outcome.kind === "logged-in") {
    return outcome.status;
  }
  const { failure } = outcome;
  if (failure.kind === "refused" && isDeviceSignUpRefusal(failure.code)) {
    const { message } = failure;
    switch (failure.code) {
      case "invite-refused": {
        throw errors.FORBIDDEN({ message });
      }
      case "account-exists": {
        throw errors.CONFLICT({ message });
      }
      case "rate-limited": {
        throw errors.TOO_MANY_REQUESTS({ message });
      }
      default: {
        const unanswered: never = failure.code;
        return unanswered;
      }
    }
  }
  throw errors.PROVIDER_UNAVAILABLE({ message: describeCloudFailure(failure) });
});

const logout = base.cloud.logout.handler(({ context }) => context.cloud.logout());

const devices = base.cloud.devices.handler(async ({ context, errors }) => {
  const outcome = await context.cloud.devices();
  switch (outcome.kind) {
    case "answered": {
      return outcome.value;
    }
    case "not-live": {
      throw errors.PRECONDITION_FAILED({ message: outcome.message });
    }
    case "failed": {
      throw errors.PROVIDER_UNAVAILABLE({ message: describeCloudFailure(outcome.failure) });
    }
    default: {
      const unanswered: never = outcome;
      return unanswered;
    }
  }
});

const revokeDevice = base.cloud.revokeDevice.handler(async ({ context, input, errors }) => {
  const outcome = await context.cloud.revokeDevice(input.deviceId);
  switch (outcome.kind) {
    case "answered": {
      return outcome.value;
    }
    case "this-device": {
      throw errors.BAD_REQUEST({ message: "That's this Mac. Sign it out instead." });
    }
    case "not-live": {
      throw errors.PRECONDITION_FAILED({ message: outcome.message });
    }
    case "failed": {
      const { failure } = outcome;
      // another account's device and one already revoked answer alike
      if (failure.kind === "refused" && failure.code === "not-found") {
        throw errors.NOT_FOUND({ message: "That device isn't signed in to your account anymore." });
      }
      throw errors.PROVIDER_UNAVAILABLE({ message: describeCloudFailure(failure) });
    }
    default: {
      const unanswered: never = outcome;
      return unanswered;
    }
  }
});

const syncNow = base.cloud.syncNow.handler(async ({ context }) => await context.cloud.syncNow());

const prefs = base.cloud.prefs.handler(({ context }) => ({
  phoneRequests: context.cloudPrefs.phoneRequests(),
}));

// a pass reads the choice as it starts; the socket dials again to announce it, and its opening
// runs the pass that answers a request waiting for a Mac that takes them
const setPrefs = base.cloud.setPrefs.handler(({ context, input }) => {
  context.cloudPrefs.write({ ...context.cloudPrefs.read(), phoneRequests: input.phoneRequests });
  context.cloud.phoneRequestsChanged();
  return { phoneRequests: context.cloudPrefs.phoneRequests() };
});

export const cloudRouter = {
  devices,
  login,
  logout,
  prefs,
  revokeDevice,
  setPrefs,
  signUp,
  status,
  syncNow,
};
