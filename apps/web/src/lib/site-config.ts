const GITHUB = "https://github.com/kyh/inteligir";

export const siteConfig = {
  contact: { email: "kai@kyh.io" },
  description: "Everything you save and write, in one library on your Mac.",
  // the dmg under the fixed name the package step gives it (apps/desktop/scripts/package.ts), so
  // GitHub redirects to the latest release's copy with no API call
  downloadUrl: `${GITHUB}/releases/latest/download/Inteligir-arm64.dmg`,
  github: GITHUB,
  name: "Inteligir",
  shortName: "Inteligir",
  twitter: "@kaiyuhsu",
  twitterUrl: "https://x.com/kaiyuhsu",
  url: "https://inteligir.com",
};
