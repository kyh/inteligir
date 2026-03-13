"use client";

import Link from "next/link";
import { Logo } from "@repo/ui/logo";
import { useTheme } from "@repo/ui/theme";

export const Header = () => {
  const { theme, setTheme } = useTheme();

  return (
    <header>
      <div className="flex items-center justify-between py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="sr-only">Go to homepage</span>
          <Logo />
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="https://github.com/kyh/inteligir"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground/60 hover:text-foreground"
          >
            GitHub
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme("light")}
              className={`size-2 rounded-full bg-white outline-2 outline-foreground/20 transition-all ${
                theme === "light" ? "outline" : ""
              }`}
              title="Light"
            />
            <button
              onClick={() => setTheme("dark")}
              className={`size-2 rounded-full bg-black outline-2 outline-foreground/20 transition-all ${
                theme === "dark" ? "outline" : ""
              }`}
              title="Dark"
            />
          </div>
        </nav>
      </div>
    </header>
  );
};
