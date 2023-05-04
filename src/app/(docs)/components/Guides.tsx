import Link from "next/link";
import { ArrowRightIcon } from "@heroicons/react/24/outline";
import { Button } from "~/components/Button";

const guides = [
  {
    href: "/authentication",
    name: "Authentication",
    description: "Learn how to authenticate your API requests.",
  },
  {
    href: "/authentication",
    name: "Cache your APIs",
    description: "Caching your first endpoint in less than 5 minutes.",
  },
  {
    href: "/errors",
    name: "Errors",
    description:
      "Read about the different types of errors returned by the API.",
  },
  {
    href: "/webhooks",
    name: "Webhooks",
    description:
      "Learn how to programmatically configure webhooks for your app.",
  },
];

export function Guides() {
  return (
    <div className="my-16 xl:max-w-none">
      <h2 id="guides">Guides</h2>
      <div className="not-prose mt-4 grid grid-cols-1 gap-8 border-t border-white/10 border-white/10 pt-10 sm:grid-cols-2 xl:grid-cols-4">
        {guides.map((guide) => (
          <div key={guide.href}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {guide.name}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {guide.description}
            </p>
            <p className="mt-4">
              <Button as={Link} href={guide.href} variant="text" size="none">
                Read more
                <ArrowRightIcon className="ml-1 h-4 w-4" />
              </Button>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
