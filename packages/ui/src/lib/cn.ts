import { createCn } from "cn/config";

import { typeScale } from "@repo/ui/lib/size-context";

// The type roles are font sizes. Unregistered, `text-body` merges as a colour (any unknown value
// after `text-` is one), so `cn("text-body", "text-muted-foreground")` would drop the size; named,
// a role also replaces another role, which no CSS ordering can do.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: Object.keys(typeScale) }],
    },
  },
});
