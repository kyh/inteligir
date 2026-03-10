import Link from "next/link";
import { buttonVariants } from "@repo/ui/button";
import { Logo } from "@repo/ui/logo";
import { cn } from "@repo/ui/utils";

export const Header = () => {
  return (
    <header className="flex items-center justify-between pt-16">
      <Link href="/">
        <Logo />
      </Link>
      <div className="flex flex-1 items-center justify-end gap-3">
        <Link
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-xs")}
          href="/docs"
        >
          Docs
        </Link>
        <Link
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "text-xs")}
          href="https://github.com/kyh/inteligir"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </Link>
      </div>
    </header>
  );
};
