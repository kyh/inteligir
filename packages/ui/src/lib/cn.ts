import { createCn } from "cn/config";

import { typeScale } from "@repo/ui/lib/size-context";

// The merge engine has to be told that the type roles are font sizes. Left to its defaults it
// reads `text-body` as a colour — any unknown value after `text-` is one — so `cn("text-body",
// "text-muted-foreground")` dropped the size and the line fell back to the inherited 16px. Named
// here, a role also correctly replaces another role, which no amount of CSS ordering can do.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: Object.keys(typeScale) }],
    },
  },
});
