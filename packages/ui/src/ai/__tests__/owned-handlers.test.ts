import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";

import type { ApprovalOption } from "../approval-card";
import type { CodeBlockCopy } from "../code-block";
import type { DiffRow } from "../diff-table";
import type { GlideList } from "../glide-list";
import type { InsightChart } from "../insight-cards";
import type { TaskItemRow } from "../task-rows";
import type { ThinkingStep } from "../thinking";

// a spread {...props} lands after the component's own handler, so a forwarded one would replace
// it: the row stops toggling, the chart stops scrubbing, while its ARIA still promises the behaviour
describe("an ai/ control has one activation channel", () => {
  it("refuses a forwarded handler the component owns", () => {
    expectTypeOf<ComponentProps<typeof ThinkingStep>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof TaskItemRow>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof ApprovalOption>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof CodeBlockCopy>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof DiffRow>>().not.toHaveProperty("onClick");
    expectTypeOf<ComponentProps<typeof DiffRow>>().not.toHaveProperty("onKeyDown");
    expectTypeOf<ComponentProps<typeof GlideList>>().not.toHaveProperty("onPointerMove");
    expectTypeOf<ComponentProps<typeof GlideList>>().not.toHaveProperty("onPointerLeave");
    expectTypeOf<ComponentProps<typeof GlideList>>().not.toHaveProperty("onFocus");
    expectTypeOf<ComponentProps<typeof GlideList>>().not.toHaveProperty("onBlur");
    expectTypeOf<ComponentProps<typeof InsightChart>>().not.toHaveProperty("onPointerMove");
    expectTypeOf<ComponentProps<typeof InsightChart>>().not.toHaveProperty("onPointerDown");
    expectTypeOf<ComponentProps<typeof InsightChart>>().not.toHaveProperty("onPointerLeave");
    expectTypeOf<ComponentProps<typeof InsightChart>>().not.toHaveProperty("onPointerUp");
  });
});
