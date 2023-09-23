import { useMDXComponent } from "next-contentlayer/hooks";
import Image from "next/image";
import { Callout } from "./callout";
import { Code } from "./code";
import { H1, H2, H3, H4 } from "./headings";
import { Li } from "./li";
import { Link } from "./link";
import { Ol } from "./ol";
import { P } from "./p";
import { Pre } from "./pre";
import { Span } from "./span";
import { Ul } from "./ul";
import type { MDXComponents } from "mdx/types";

const MDX_COMPONENTS: MDXComponents = {
  // basic
  a: ({ href, children }) => <Link href={href as string}>{children}</Link>,
  Image: ({ src, alt, width, height }) => (
    <Image
      src={src as string}
      alt={alt as string}
      width={width as number}
      height={height as number}
    />
  ),
  h1: ({ children }) => <H1>{children}</H1>,
  h2: ({ children }) => <H2>{children}</H2>,
  h3: ({ children }) => <H3>{children}</H3>,
  h4: ({ children }) => <H4>{children}</H4>,
  pre: ({ children, className, ...props }) => (
    <Pre {...props} className={className}>
      {children}
    </Pre>
  ),
  code: ({ children, className, ...props }) => (
    <Code {...props} className={className}>
      {children}
    </Code>
  ),
  p: ({ children, className, ...props }) => (
    <P {...props} className={className}>
      {children}
    </P>
  ),
  span: ({ children, className, ...props }) => (
    <Span {...props} className={className}>
      {children}
    </Span>
  ),
  ul: ({ children, className, ...props }) => (
    <Ul {...props} className={className}>
      {children}
    </Ul>
  ),
  ol: ({ children, className, ...props }) => (
    <Ol {...props} className={className}>
      {children}
    </Ol>
  ),
  li: ({ children, className, ...props }) => (
    <Li {...props} className={className}>
      {children}
    </Li>
  ),

  // custom
  Callout: ({ children, className, ...props }) => (
    <Callout {...props} className={className}>
      {children}
    </Callout>
  ),
};

export default function MDX({ content }: { content: string }) {
  const Component = useMDXComponent(content);

  if (Component) {
    return (
      <div className="text-base">
        <Component components={MDX_COMPONENTS} />
      </div>
    );
  }

  return <div />;
}
