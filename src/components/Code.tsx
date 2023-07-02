import { Children } from "react";
import { CopyIcon } from "lucide-react";
import toaster from "react-hot-toast";
import { cn } from "~/lib/utils/cn";

type CodeProps = {
  children?: React.ReactNode;
  className?: string;
  copy?: boolean;
};

export const Code = ({ children, className, copy = true }: CodeProps) => {
  const copyToClipboard = () => {
    let copiedText = "";
    if (!children) return;
    if (typeof children === "object") {
      copiedText = Children.toArray(children)
        .map((c) => c.toString())
        .join("");
    } else {
      copiedText = children.toString();
    }
    navigator.clipboard.writeText(copiedText);
    toaster("Copied to clipboard");
  };

  return (
    <pre
      className={cn(
        `inline-flex items-center rounded border border-white/10 bg-zinc-900 p-3 font-mono text-sm shadow transition`,
        copy && "hover:cursor-pointer hover:bg-black",
        className
      )}
      onClick={copy ? copyToClipboard : undefined}
    >
      {copy && <CopyIcon className="mr-2 h-4 w-4" />}
      {children}
    </pre>
  );
};
