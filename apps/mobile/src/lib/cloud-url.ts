import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/origin";

const isWebOrigin = (url: URL) => url.protocol === "https:" || url.protocol === "http:";

const parseUrl = (value: string) => {
  try {
    return new URL(value) satisfies URL | null;
  } catch {
    return null;
  }
};

export const getCloudUrl = () => {
  const raw = process.env.EXPO_PUBLIC_CLOUD_URL;
  const configured = raw === undefined ? "" : raw.trim();

  if (configured === "") {
    return PRODUCTION_CLOUD_ORIGIN;
  }

  const url = parseUrl(configured);

  if (url === null || !isWebOrigin(url)) {
    throw new Error(
      `EXPO_PUBLIC_CLOUD_URL must be an absolute http(s) URL (got "${configured}"); unset it to use ${PRODUCTION_CLOUD_ORIGIN}`,
    );
  }

  return url.origin;
};
