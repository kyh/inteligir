import { describe, expect, it } from "vitest";

import { isLoopbackName, isPrivateUseName, namesPrivateSpace } from "./host-names";

describe("isLoopbackName", () => {
  it("names localhost and every name under it, in any case and with a trailing dot", () => {
    for (const name of ["localhost", "LOCALHOST", "localhost.", "a.localhost", "x.y.Localhost"]) {
      expect(isLoopbackName(name), name).toBe(true);
    }
    for (const name of ["localhost.com", "mylocalhost", "example.com"]) {
      expect(isLoopbackName(name), name).toBe(false);
    }
  });
});

describe("isPrivateUseName", () => {
  it("names one label and the suffixes a home or an office keeps", () => {
    for (const name of ["nas", "wiki.", "printer.local", "box.home.arpa", "git.corp", "a.lan"]) {
      expect(isPrivateUseName(name), name).toBe(true);
    }
    for (const name of ["example.com", "local.example.com", "lan.example"]) {
      expect(isPrivateUseName(name), name).toBe(false);
    }
  });
});

describe("namesPrivateSpace", () => {
  it("reads a private place from the address's spelling alone", () => {
    for (const url of [
      "http://localhost:8080/a",
      "http://nas/photo.jpg",
      "http://printer.local/status",
      "http://192.168.1.1/admin.png",
      "http://8.8.8.8/x.png",
      "http://[::1]/x",
      "not a url",
    ]) {
      expect(namesPrivateSpace(url), url).toBe(true);
    }
  });

  it("leaves a public name public", () => {
    for (const url of ["https://cdn.example.com/cover.jpg", "https://i.ytimg.com/vi/x/hq.jpg"]) {
      expect(namesPrivateSpace(url), url).toBe(false);
    }
  });
});
