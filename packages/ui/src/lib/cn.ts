import { createCn } from "cn/config";

export const TYPE_ROLES = ["caption", "body", "subtitle", "title", "display"] as const;

export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TYPE_ROLES] }],
    },
  },
});
