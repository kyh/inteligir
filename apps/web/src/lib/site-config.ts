export const siteConfig = {
  name: "Inteligir",
  shortName: "Inteligir",
  description: "The agent lab",
  url:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://init.kyh.io",
  twitter: "@kaiyuhsu",
};
