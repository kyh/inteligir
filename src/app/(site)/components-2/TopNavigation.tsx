import Link from "next/link";
import { useScroll } from "framer-motion";
import { Logo } from "~/components/Logo";
import { NavLink } from "~/components/NavLink";
import clsx from "clsx";
import { useEffect, useState } from "react";

const baseContainerClassName = "sticky top-0 z-40 w-full bg-transparent";

export const TopNavigation = () => {
  const [containerClassName, setContainerClassName] = useState(
    baseContainerClassName
  );
  const { scrollY } = useScroll();

  useEffect(() => {
    const subscription = scrollY.on("change", () => {
      if (scrollY.get() > 100) {
        setContainerClassName(clsx(baseContainerClassName, "backdrop-blur"));
      } else {
        setContainerClassName(baseContainerClassName);
      }
    });
    return () => subscription();
  }, [scrollY]);

  return (
    <div className={containerClassName}>
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
        <Link href="/">
          <Logo />
        </Link>
        <nav>
          <ul className="flex gap-3 md:gap-8">
            <li>
              <NavLink to="/">Home</NavLink>
            </li>
            <li>
              <NavLink to="/docs/introduction">Documentation</NavLink>
            </li>
            <li>
              <NavLink to="/pricing">Pricing</NavLink>
            </li>
          </ul>
        </nav>
        <button className="text-sm">Sign in</button>
      </div>
    </div>
  );
};
