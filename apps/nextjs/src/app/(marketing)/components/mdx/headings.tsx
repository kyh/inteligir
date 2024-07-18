import Link from "next/link";
import { clx } from "@inteligir/ui";

import { getNodeText, sluggifyTitle } from "@/lib/content";

const Heading = (variant: "1" | "2" | "3" | "4") => {
  const Component: React.FC<React.HTMLProps<HTMLHeadingElement>> = ({
    children,
  }) => {
    const Tag = `h${variant}` as keyof JSX.IntrinsicElements;
    const slug = sluggifyTitle(getNodeText(children));

    return (
      <Tag
        className={clx("group mb-2 mt-8 scroll-mt-24 font-medium", {
          "text-3xl font-bold": variant === "1",
          "text-2xl font-semibold": variant === "2",
          "text-xl font-medium": variant === "3",
          "text-lg": variant === "4",
        })}
        id={slug}
      >
        <Link href={`#${slug}`}>
          <span className="text-ui-fg-base absolute left-[0px] z-10 hidden lg:group-hover:inline">
            #
          </span>
          {children}
        </Link>
      </Tag>
    );
  };

  return Component;
};

export const H1 = Heading("1");
export const H2 = Heading("2");
export const H3 = Heading("3");
export const H4 = Heading("4");
