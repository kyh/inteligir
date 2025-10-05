export const siteConfig = {
  name: "OpenWebsets",
  shortName: "OpenWebsets",
  description: "Open source alternative to Exa Websets - Create, manage, and share web search collections.",
  url:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://init.kyh.io",
  twitter: "@kaiyuhsu",
};
