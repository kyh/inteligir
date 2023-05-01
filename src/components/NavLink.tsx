import { Link } from "@remix-run/react";
import { classed } from "@tw-classed/react";

export const NavLink = classed(Link, {
  base: "block py-1 text-xs capitalize text-gray-400 transition hover:text-white",
});
