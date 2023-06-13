import Link from "next/link";
import { classed } from "~/lib/utils/cn";

export const NavLink = classed(Link, {
  base: "block p-1 -mx-1 text-xs capitalize text-zinc-400 transition hover:text-white",
  variants: {
    variant: {
      primary: "text-sm text-white",
    },
  },
});
