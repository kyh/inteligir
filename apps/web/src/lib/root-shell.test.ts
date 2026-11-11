import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "../routeTree.gen";
import { siteGraph } from "./structured-data";

const rendered = async (path: string): Promise<string> => {
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    isServer: true,
    routeTree,
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
};

describe("the marketing document shell", () => {
  it("renders a path nothing serves inside the <html> shell", async () => {
    const html = await rendered("/no-such-page");
    expect(html).toContain("<html");
    expect(html).toContain("stylesheet");
    expect(html).toContain("404");
  });

  it("carries the site's graph as JSON-LD, with no raw `<`", async () => {
    const html = await rendered("/about");
    const jsonLd = [
      ...html.matchAll(/<script type="application\/ld\+json">(?<json>.*?)<\/script>/gu),
    ].map((match) => match.groups?.json ?? "");
    expect(jsonLd.some((json) => json.includes("<"))).toBe(false);
    expect(jsonLd).toContain(JSON.stringify(siteGraph()));
  });
});
