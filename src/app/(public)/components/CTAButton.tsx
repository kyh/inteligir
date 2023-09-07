import { cn } from "~/lib/cn";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

export function CTAButton({
  size = "default",
}: {
  size?: "default" | "small";
}) {
  return (
    <Link href="/signin">
      <button
        className={cn(
          "group flex items-center rounded-lg bg-black py-2 pl-5 pr-4 text-lg text-white shadow transition hover:bg-gray-700 hover:shadow-lg active:shadow-none md:py-3 md:pl-8 md:pr-6",
          {
            "py-2 px-5 text-base md:py-2 md:px-5": size === "small",
          }
        )}
      >
        <span>Get Started</span>
        {<ArrowRight className="ml-1 h-5 w-5" />}
      </button>
    </Link>
  );
}
