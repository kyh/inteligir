import { memo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";

const plugins = { code };

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Streamdown plugins={plugins} shikiTheme={["github-dark-dimmed", "github-dark-dimmed"]}>
        {content}
      </Streamdown>
    </div>
  );
});
