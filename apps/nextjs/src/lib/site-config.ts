export const siteConfig = {
  name: "Inteligir",
  shortName: "Inteligir",
  description:
    "An adaptive and intelligent block-based editor that connects with your proprietary data and helps you generate content, visualizations, and custom interfaces.",
  url:
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://inteligir.com",
  twitter: "@kaiyuhsu",
};
