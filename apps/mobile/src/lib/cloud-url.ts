import { PRODUCTION_CLOUD_ORIGIN } from "@repo/api/cloud/origin";

const isWebOrigin = (url: URL): boolean =>
  (url.protocol === "https:" || url.protocol === "http:") && url.origin !== "";

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

// unset is production, as it is for the desktop, so a store build carries no value and cannot
// point anywhere else. no LAN-host fallback: the Worker's dev server binds localhost, so a guessed
// Metro-host origin never answers a phone.
export const getCloudUrl = (): string => {
  // spelled whole: Metro inlines an EXPO_PUBLIC_ variable only at a static member access.
  const raw = process.env.EXPO_PUBLIC_CLOUD_URL;
  const configured = raw === undefined ? "" : raw.trim();
  if (configured === "") {
    return PRODUCTION_CLOUD_ORIGIN;
  }
  // React Native's URL never throws on a malformed value; it answers an empty origin instead.
  const url = parseUrl(configured);
  if (url === null || !isWebOrigin(url)) {
    throw new Error(
      `EXPO_PUBLIC_CLOUD_URL must be an absolute http(s) URL (got "${configured}"); unset it to use ${PRODUCTION_CLOUD_ORIGIN}`,
    );
  }
  // origin only: `new URL("/v1/…", base)` drops any path the base carries.
  return url.origin;
};
