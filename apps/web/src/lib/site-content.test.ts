import { describe, expect, it } from "vitest";

import { PAGES } from "./page-meta";
import {
  aboutMarkdown,
  contactMarkdown,
  homeMarkdown,
  llmsTxt,
  notFoundMarkdown,
  SITEMAP_PATHS,
} from "./site-content";
import { siteConfig } from "./site-config";
import { siteGraph } from "./structured-data";

const MIN_CHARS = 500;

const PREVIEW = "https://inteligir-git-branch.vercel.app";
const LLMS = llmsTxt(PREVIEW);

const flowing = (text: string) =>
  text
    .replaceAll(/<[^>]*>/gu, " ")
    .replaceAll(/[\s>]+/gu, " ")
    .replaceAll("&#x27;", "'");

const RETIRED_CLAIMS: readonly (readonly [string, RegExp])[] = [
  ["a plan of the person's own", /\bown (?:[\w-]+ ){0,4}plan\b|\bClaude plan\b|\bChatGPT plan\b/iu],
  ["an optional account", /\boptional account\b|\baccount is optional\b/iu],
  ["no cloud behind the library", /\bno cloud request\b/iu],
  ["a folder the person owns", /\bfolders? (?:you|they) (?:own|choose)\b|\bfiles you own\b/iu],
  [
    "plain files on the Mac",
    /\bplain (?:files|markdown)\b|\bfolder on (?:your|the user's) Mac\b/iu,
  ],
  ["a folder opened in place", /\bObsidian folder opens\b/iu],
  ["a 10 MB limit on files", /\b10 MB\b/u],
  ["no model call through us", /\bnever routes a model call\b/iu],
  ["the app and agent on the Mac alone", /\bruns? on (?:your|that) Mac\b/iu],
  ["the Mac as where data starts", /\bleaves? (?:your|the user's) Mac\b/iu],
  ["a library on the Mac alone", /\blibrary on your Mac\b/iu],
  ["a copy of the library on the phone", /\bkeeps? a copy\b|\bcopy of every item\b/iu],
];

const claimsIn = (text: string) =>
  RETIRED_CLAIMS.flatMap(([claim, pattern]) => (pattern.test(flowing(text)) ? [claim] : []));

describe("the site's markdown", () => {
  it.each([
    ["home", homeMarkdown],
    ["about", aboutMarkdown],
    ["contact", contactMarkdown],
  ])("%s opens with one h1 and carries real content", (_page, markdown) => {
    expect(markdown.startsWith("# ")).toBe(true);
    expect(markdown.match(/^# /gmu)).toHaveLength(1);
    expect(markdown.length).toBeGreaterThan(MIN_CHARS);
  });

  it.each([
    ["home", homeMarkdown],
    ["about", aboutMarkdown],
    ["contact", contactMarkdown],
    ["llms.txt", LLMS],
  ])("%s makes none of the replaced product's claims", (_page, markdown) => {
    expect(claimsIn(markdown)).toStrictEqual([]);
  });

  it.each([
    ["home", homeMarkdown],
    ["about", aboutMarkdown],
    ["llms.txt", LLMS],
  ])("%s says what the product is", (_page, markdown) => {
    const text = flowing(markdown);
    expect(text).toMatch(/\baccount is required\b/iu);
    expect(text).toMatch(/\bfirst 1 GB is free\b/iu);
    expect(text).toMatch(/\bkeeps what (?:you last opened|it last read)\b/iu);
    expect(text).toMatch(/\bwith no connection\b/iu);
    expect(text).toMatch(/\bagent is built in\b|\bbuilt-in (?:AI )?agent\b/iu);
    expect(text).toMatch(/\b100 MB\b/u);
    expect(text).toMatch(/\bcloud reads\b/iu);
  });

  it("gives the contact email", () => {
    expect(contactMarkdown).toContain(siteConfig.contact.email);
  });

  it.each([
    ["home", homeMarkdown],
    ["llms.txt", LLMS],
  ])("%s links the library", (_page, markdown) => {
    expect(markdown).toContain(`(${siteConfig.url}/library)`);
  });

  it("shapes llms.txt per llmstxt.org with when-to-use guidance", () => {
    expect(LLMS).toMatch(/^# Inteligir\n\n> /u);
    expect(LLMS).toContain("## When to use Inteligir");
    expect(LLMS).toContain(`${siteConfig.url}/sitemap.xml`);
  });

  it("sends an agent to the connector of the deployment it asked, and every reader to the site", () => {
    expect(LLMS).toContain(`${PREVIEW}/connector`);
    expect(LLMS).not.toContain(`${siteConfig.url}/connector`);
    expect(LLMS).toContain(`(${siteConfig.url}/privacy)`);
  });

  it.each(["/privacy", "/terms"])("lists the legal page %s in the sitemap", (path) => {
    expect(SITEMAP_PATHS).toContain(path);
  });

  it.each(["/privacy", "/terms"])(
    "links the legal page %s from the home page and llms.txt",
    (path) => {
      expect(homeMarkdown).toContain(`(${siteConfig.url}${path})`);
      expect(LLMS).toContain(`(${siteConfig.url}${path})`);
    },
  );

  it("points a 404 at recovery links", () => {
    const body = notFoundMarkdown("/nope");
    expect(body).toContain("`/nope`");
    expect(body).toContain(`${siteConfig.url}/llms.txt`);
    expect(body).toContain(`${siteConfig.url}/sitemap.xml`);
  });
});

describe("what a page says about the product", () => {
  it.each(Object.values(PAGES).map((page) => [page.path, page.description] as const))(
    "%s describes itself in the product's terms",
    (_path, description) => {
      expect(claimsIn(description)).toStrictEqual([]);
    },
  );

  it("describes the site and the app in the product's terms", () => {
    expect(claimsIn(siteConfig.description)).toStrictEqual([]);
    expect(claimsIn(JSON.stringify(siteGraph()))).toStrictEqual([]);
  });
});

describe("the JSON-LD graph", () => {
  const graph = siteGraph()["@graph"];

  it("names the organization, the website and the app", () => {
    expect(graph.map((node) => node["@type"])).toStrictEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
    ]);

    for (const node of graph) {
      expect(node.name).toBe(siteConfig.name);
      expect(node.url).toBe(siteConfig.url);
    }
  });

  it("gives the organization a contact point", () => {
    expect(graph[0]?.contactPoint?.email).toBe(siteConfig.contact.email);
  });
});
