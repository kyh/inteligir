import { createCn } from "cn/config";

// the chrome's type roles, which `styles/globals.css` declares as `--text-<role>`
export const TYPE_ROLES = ["caption", "body", "subtitle", "title", "display"] as const;

// The type roles are font sizes. Unregistered, `text-body` merges as a colour (any unknown value
// after `text-` is one), so `cn("text-body", "text-muted-foreground")` would drop the size; named,
// a role also replaces another role, which no CSS ordering can do.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_ROLES] }],
    },
  },
});
