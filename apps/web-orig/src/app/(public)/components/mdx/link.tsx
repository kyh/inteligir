import NextLink from "next/link";
import type { FC } from "react";
import { ArrowUpRightMini } from "@inteligir/icons";

export const Link: FC<React.HTMLProps<HTMLAnchorElement>> = ({
  href = "",
  children,
}) => {
  const isExternalUrl = !(href.startsWith("/") || href.startsWith("#"));

  return (
    <NextLink
      href={href}
      rel={isExternalUrl ? "noreferrer" : undefined}
      target={isExternalUrl ? "_blank" : undefined}
    >
      <span className="inline-flex items-center font-medium underline">
        <span>{children}</span>
        {isExternalUrl ? (
          <span className="block w-4">
            <ArrowUpRightMini className="w-4" />
          </span>
        ) : null}
      </span>
    </NextLink>
  );
};
