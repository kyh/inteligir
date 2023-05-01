"use client";

import { MinusIcon, PlusIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useState } from "react";

import Heading from "~/core/ui/Heading";
import IconButton from "~/core/ui/IconButton";

function FaqItem({
  item,
}: React.PropsWithChildren<{
  item: {
    question: string;
    answer: string;
  };
}>) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => setExpanded((isExpanded) => !isExpanded);

  return (
    <div className="border-b border-gray-100 px-2 py-4 dark:border-black-300">
      <div className="flex justify-between">
        <Heading type={2}>
          <span
            onClick={toggle}
            className={
              "text-lg font-semibold text-gray-700 hover:text-current" +
              " cursor-pointer hover:underline dark:text-gray-300" +
              " dark:hover:text-white"
            }
          >
            {item.question}
          </span>
        </Heading>

        <div>
          <IconButton onClick={toggle}>
            {expanded ? (
              <MinusIcon className="h-5" />
            ) : (
              <PlusIcon className="h-5" />
            )}
          </IconButton>
        </div>
      </div>

      <div
        className={clsx(
          "flex flex-col space-y-2 py-1 text-gray-500 dark:text-gray-400",
          {
            hidden: !expanded,
          }
        )}
        dangerouslySetInnerHTML={{ __html: item.answer }}
      />
    </div>
  );
}

export default FaqItem;
