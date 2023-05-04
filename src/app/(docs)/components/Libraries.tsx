import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { Button } from "~/components/Button";
import logoGo from "~/app/(docs)/images/logos/go.svg";
import logoNode from "~/app/(docs)/images/logos/node.svg";
import logoPhp from "~/app/(docs)/images/logos/php.svg";
import logoPython from "~/app/(docs)/images/logos/python.svg";
import logoRuby from "~/app/(docs)/images/logos/ruby.svg";

const libraries = [
  {
    href: "#",
    name: "PHP",
    description:
      "A popular general-purpose scripting language that is especially suited to web development.",
    logo: logoPhp,
  },
  {
    href: "#",
    name: "Ruby",
    description:
      "A dynamic, open source programming language with a focus on simplicity and productivity.",
    logo: logoRuby,
  },
  {
    href: "#",
    name: "Node.js",
    description:
      "Node.js® is an open-source, cross-platform JavaScript runtime environment.",
    logo: logoNode,
  },
  {
    href: "#",
    name: "Python",
    description:
      "Python is a programming language that lets you work quickly and integrate systems more effectively.",
    logo: logoPython,
  },
  {
    href: "#",
    name: "Go",
    description:
      "An open-source programming language supported by Google with built-in concurrency.",
    logo: logoGo,
  },
];

export function Libraries() {
  return (
    <div className="my-16 xl:max-w-none">
      <h2 id="official-libraries">Official libraries</h2>
      <div className="not-prose mt-4 grid grid-cols-1 gap-x-6 gap-y-10 border-t border-white/10 border-white/10 pt-10 sm:grid-cols-2 xl:max-w-none xl:grid-cols-3">
        {libraries.map((library) => (
          <div key={library.name} className="flex flex-row-reverse gap-6">
            <div className="flex-auto">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {library.name}
              </h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {library.description}
              </p>
              <p className="mt-4">
                <Button
                  as={Link}
                  href={library.href}
                  variant="text"
                  size="none"
                >
                  Read more
                  <ArrowRightIcon className="ml-1 h-4 w-4" />
                </Button>
              </p>
            </div>
            <img src={library.logo} alt="" className="h-12 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
