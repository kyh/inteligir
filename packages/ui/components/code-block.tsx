"use client";

import { Highlight, themes } from "prism-react-renderer";
import * as React from "react";
import { cn } from "../lib/cn";
import { Copy } from "./copy";

export type CodeSnippet = {
  label: string;
  language: string;
  code: string;
  hideLineNumbers?: boolean;
};

type CodeBlockState = {
  snippets: CodeSnippet[];
  active: CodeSnippet;
  setActive: (active: CodeSnippet) => void;
} | null;

const CodeBlockContext = React.createContext<CodeBlockState>(null);

const useCodeBlockContext = () => {
  const context = React.useContext(CodeBlockContext);

  if (context === null)
    throw new Error(
      "useCodeBlockContext can only be used within a CodeBlockContext",
    );

  return context;
};

type RootProps = {
  snippets: CodeSnippet[];
};

const Root = ({
  snippets,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & RootProps) => {
  const [active, setActive] = React.useState(snippets[0]);

  return (
    <CodeBlockContext.Provider value={{ snippets, active, setActive }}>
      <div
        className={cn(
          "overflow-hidden rounded-lg border border-ui-code-border",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </CodeBlockContext.Provider>
  );
};

type HeaderProps = {
  hideLabels?: boolean;
};

const HeaderComponent = ({
  children,
  className,
  hideLabels = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & HeaderProps) => {
  const { snippets, active, setActive } = useCodeBlockContext();
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-b-ui-code-border bg-ui-code-bg-header px-4 py-3",
        className,
      )}
      {...props}
    >
      {!hideLabels &&
        snippets.map((snippet) => (
          <div
            className={cn(
              "cursor-pointer rounded-full border border-transparent px-3 py-2 text-xs text-ui-code-text-subtle transition-all",
              {
                "cursor-default border-ui-code-border bg-ui-code-bg-base text-ui-code-text-base":
                  active.label === snippet.label,
              },
            )}
            key={snippet.label}
            onClick={() => {
              setActive(snippet);
            }}
          >
            {snippet.label}
          </div>
        ))}
      {children}
    </div>
  );
};

const Meta = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn("ml-auto text-ui-code-text-subtle", className)}
      {...props}
    />
  );
};

const Header = Object.assign(HeaderComponent, { Meta });

const Body = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const { active } = useCodeBlockContext();
  return (
    <div
      className={cn("relative bg-ui-code-bg-base p-4", className)}
      {...props}
    >
      <Copy
        className="absolute right-4 top-4 text-ui-code-icon"
        content={active.code}
      />
      <div className="max-w-[90%]">
        <Highlight
          code={active.code}
          language={active.language}
          theme={{
            ...themes.palenight,
            plain: {
              color: "rgba(249, 250, 251, 1)",
              backgroundColor: "#111827",
            },
            styles: [
              {
                types: ["keyword"],
                style: {
                  color: "var(--fg-on-color)",
                },
              },
              {
                types: ["maybe-class-name"],
                style: {
                  color: "rgb(255, 203, 107)",
                },
              },
              ...themes.palenight.styles,
            ],
          }}
        >
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className="whitespace-pre-wrap bg-transparent font-mono text-xs"
              style={{
                ...style,
                background: "transparent",
              }}
            >
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })} className="flex">
                  {!active.hideLineNumbers && (
                    <span className="text-ui-code-text-subtle">{i + 1}</span>
                  )}
                  <div className="pl-4">
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
};

const CodeBlock = Object.assign(Root, { Body, Header, Meta });

export { CodeBlock };
