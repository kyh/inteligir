import { describe, expect, it } from "vitest";

import {
  aboutMarkdown,
  contactMarkdown,
  homeMarkdown,
  llmsTxt,
  notFoundMarkdown,
  SITEMAP_PATHS,
} from "../site-content";
import { siteConfig } from "../site-config";
import { serializeJsonLd, siteGraph } from "../structured-data";

// the floor agent-readiness checks hold a trust page and the homepage's raw text to
const MIN_CHARS = 500;

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

  it("gives the contact email", () => {
    expect(contactMarkdown).toContain(siteConfig.contact.email);
  });

  it("shapes llms.txt per llmstxt.org with when-to-use guidance", () => {
    expect(llmsTxt).toMatch(/^# Inteligir\n\n> /u);
    expect(llmsTxt).toContain("## When to use Inteligir");
    expect(llmsTxt).toContain(`${siteConfig.url}/sitemap.xml`);
  });

  it.each(["/privacy", "/terms"])(
    "lists the legal page %s wherever the site lists its pages",
    (path) => {
      expect(SITEMAP_PATHS).toContain(path);
      expect(homeMarkdown).toContain(`(${siteConfig.url}${path})`);
      expect(llmsTxt).toContain(`(${siteConfig.url}${path})`);
    },
  );

  it("points a 404 at recovery links", () => {
    const body = notFoundMarkdown("/nope");
    expect(body).toContain("`/nope`");
    expect(body).toContain(`${siteConfig.url}/llms.txt`);
    expect(body).toContain(`${siteConfig.url}/sitemap.xml`);
  });
});

describe("the JSON-LD graph", () => {
  const graph = siteGraph()["@graph"];

  it("names the organization, the website and the app", () => {
    expect(graph.map((node) => node["@type"])).toEqual([
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

  it("serializes to JSON that parses back to the graph with no raw `<`", () => {
    const serialized = serializeJsonLd(siteGraph());
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(siteGraph());
  });
});
