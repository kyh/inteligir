export const siteConfig = {
  name: "Inteligir",
  shortName: "Inteligir",
  description: "An agent experiment lab",
  url:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://init.kyh.io",
  twitter: "@kaiyuhsu",
};
