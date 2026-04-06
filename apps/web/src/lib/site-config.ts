export const siteConfig = {
  name: "Inteligir",
  shortName: "Inteligir",
  description: "An artificially intelligent operating system.",
  url:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://init.kyh.io",
  twitter: "@kaiyuhsu",
};
