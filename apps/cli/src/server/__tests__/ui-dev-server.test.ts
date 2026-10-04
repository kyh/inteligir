import { once } from "node:events";
import { createServer } from "node:http";
import { BROWSER_HANDOFF_PARAM } from "@repo/contract/local/routes";
import { describe, expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { BROWSER_SESSION_COOKIE } from "../browser-session";
import { UI_DEV_URL_ENV_VAR, uiDevOrigin } from "../ui-dev-server";
import { bootTestApp } from "./boot-app";

const boundAddressSchema = z.object({ port: z.number().int() });

// a stand-in for Vite's dev server: it names every path it was asked, and answers a module
const fakeVite = async () => {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end("export const page = 1;\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  onTestFinished(async () => {
    server.close();
    await once(server, "close");
  });
  const { port } = boundAddressSchema.parse(server.address());
  return { asked, origin: `http://127.0.0.1:${String(port)}` };
};

describe("a development shell's Vite", () => {
  it("is named only in development, and only as a loopback http origin", () => {
    const named = { [UI_DEV_URL_ENV_VAR]: "http://localhost:31000/" };
    expect(uiDevOrigin(named, "dev")).toBe("http://localhost:31000");
    expect(uiDevOrigin(named, "prod")).toBeNull();
    expect(uiDevOrigin({}, "dev")).toBeNull();
    expect(() => uiDevOrigin({ [UI_DEV_URL_ENV_VAR]: "http://example.com:31000" }, "dev")).toThrow(
      /loopback http origin/u,
    );
    expect(() => uiDevOrigin({ [UI_DEV_URL_ENV_VAR]: "https://localhost:31000" }, "dev")).toThrow(
      /loopback http origin/u,
    );
    expect(() => uiDevOrigin({ [UI_DEV_URL_ENV_VAR]: "not a url" }, "dev")).toThrow(/a URL/u);
  });

  it("answers the page's files for a signed-in window, through this server's own sign-in", async () => {
    const vite = await fakeVite();
    const booted = await bootTestApp({ uiDevOrigin: vite.origin });
    const { nonce } = await booted.client.system.browserHandoff();
    const traded = await booted.bareRequest(`/?${BROWSER_HANDOFF_PARAM}=${nonce}`);
    expect(traded.status).toBe(303);
    const [cookie = ""] = (traded.headers.get("set-cookie") ?? "").split(";");
    expect(cookie.startsWith(`${BROWSER_SESSION_COOKIE}=`)).toBe(true);

    const module = await booted.bareRequest("/src/main.tsx?t=1", {
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(module.status).toBe(200);
    expect(module.headers.get("content-type")).toBe("text/javascript");
    expect(await module.text()).toBe("export const page = 1;\n");
    expect(vite.asked).toEqual(["/src/main.tsx?t=1"]);
  });

  it("forwards nothing to a request with no session", async () => {
    const vite = await fakeVite();
    const booted = await bootTestApp({ uiDevOrigin: vite.origin });
    const refused = await booted.bareRequest("/");
    expect(refused.status).toBe(401);
    expect(vite.asked).toEqual([]);
  });
});
