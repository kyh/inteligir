import { Children } from "react";
import { DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import toaster from "react-hot-toast";

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
      className={clsx(
        `inline-flex items-center rounded border border-white/10 bg-zinc-900 p-3 font-mono text-sm shadow transition`,
        copy && "hover:cursor-pointer hover:bg-black",
        className
      )}
      onClick={copy ? copyToClipboard : undefined}
    >
      {copy && <DocumentDuplicateIcon className="mr-2 h-4 w-4" />}
      {children}
    </pre>
  );
};
