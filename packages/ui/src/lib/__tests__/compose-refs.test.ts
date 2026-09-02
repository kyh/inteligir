import { describe, expect, it } from "vitest";
import { createRef } from "react";

import { composeRefs } from "../compose-refs";

describe("composeRefs", () => {
  it("writes the node into every shape a Ref can take", () => {
    const box = createRef<string>();
    const seen: (string | null)[] = [];
    const composed = composeRefs<string>(
      box,
      (node) => {
        seen.push(node);
      },
      undefined,
    );

    composed("node");
    expect(box.current).toBe("node");
    expect(seen).toEqual(["node"]);

    composed(null);
    expect(box.current).toBeNull();
    expect(seen).toEqual(["node", null]);
  });

  it("writes a lone box through, so a forwarded ref can reach an element it does not name", () => {
    const box = createRef<string>();
    composeRefs<string>(box)("node");
    expect(box.current).toBe("node");
  });
});
