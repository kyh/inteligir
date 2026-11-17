const GITHUB = "https://github.com/kyh/inteligir";

// the notices a licence asks to travel with a copy: every package the pages bundle, beside
// public/licenses, the texts of what is vendored
export const LICENSES_PATH = "/licenses.md";

export const siteConfig = {
  contact: { email: "kai@kyh.io" },
  description: "Everything you save and write, in one library on every device.",
  // the dmg under the fixed name a pack gives it (apps/desktop/scripts/release-assets.ts), so
  // GitHub redirects to the latest release's copy with no API call
  downloadUrl: `${GITHUB}/releases/latest/download/Inteligir-arm64.dmg`,
  github: GITHUB,
  name: "Inteligir",
  shortName: "Inteligir",
  twitter: "@kaiyuhsu",
  twitterUrl: "https://x.com/kaiyuhsu",
  url: "https://inteligir.com",
};
