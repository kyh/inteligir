import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";

import type { ApprovalOption } from "./approval-card";
import type { TaskItemRow } from "./task-rows";
import type { ThinkingStep } from "./thinking";

// a spread {...props} lands after the component's own handler, so a forwarded one would replace
// it: the row stops toggling while its ARIA still promises the behaviour
describe("an ai/ control has one activation channel", () => {
  it("refuses a forwarded handler the component owns", () => {
    expectTypeOf<ComponentProps<typeof ThinkingStep>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof TaskItemRow>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof ApprovalOption>>().not.toHaveProperty("onClick");
  });
});
