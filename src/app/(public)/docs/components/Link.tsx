import NextLink from "next/link";
import type { FC, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

const Link: FC<{ href: string; children: ReactNode }> = ({
  href,
  children,
}) => {
  const isExternalUrl = !(href.startsWith("/") || href.startsWith("#"));

  return (
    <NextLink
      href={href}
      target={isExternalUrl ? "_blank" : undefined}
      rel={isExternalUrl ? "noreferrer" : undefined}
    >
      <span className="inline-flex items-center space-x-1">
        <span>{children}</span>
        {isExternalUrl && (
          <span className="block w-4">
            <ArrowUpRight className="w-4" />
          </span>
        )}
      </span>
    </NextLink>
  );
};

export default Link;
