import { Children } from "react";
import clsx from "clsx";
import { DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import toaster from "react-hot-toast";

type Props = {
  children?: React.ReactNode;
  className?: string;
  copy?: boolean;
};

export const Code = ({ children, className, copy = true }: Props) => {
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
        `inline-flex items-center rounded border border-white/10 bg-gray-900 p-3 font-mono text-sm shadow transition`,
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
