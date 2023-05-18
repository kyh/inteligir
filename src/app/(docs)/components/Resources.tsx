import Link from "next/link";
import {
  ChartBarIcon,
  DocumentIcon,
  PhoneIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { HighlightCard } from "~/components/Card";

const resources = [
  {
    href: "docs/resource/cache",
    name: "Cache",
    description:
      "Learn about the Cache model and how to create, retrieve, update, delete, and list your cached resources.",
    icon: DocumentIcon,
    pattern: {
      y: 16,
      squares: [
        [0, 1],
        [1, 3],
      ],
    },
  },
  {
    href: "docs/resource/clients",
    name: "Clients",
    description:
      "Gain full visibility of each client that is using your cached resources.",
    icon: PhoneIcon,
    pattern: {
      y: -6,
      squares: [
        [-1, 2],
        [1, 3],
      ],
    },
  },
  {
    href: "docs/resource/activity",
    name: "Activity",
    description:
      "Get a realtime stream of APIs being hit and the performance of each response.",
    icon: ChartBarIcon,
    pattern: {
      y: 32,
      squares: [
        [0, 2],
        [1, 4],
      ],
    },
  },
  {
    href: "docs/resource/stats",
    name: "Stats",
    description:
      "Putcache computes a simple set of usage analytics that describes how your clients are using cached resources.",
    icon: UsersIcon,
    pattern: {
      y: 22,
      squares: [[0, 1]],
    },
  },
];

function ResourceIcon({ icon: Icon }: { icon: React.ComponentType<any> }) {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/7.5 ring-1 ring-white/15 backdrop-blur-[2px] transition duration-300 group-hover:bg-emerald-300/10 group-hover:ring-emerald-400 group-hover:ring-gray-900/25">
      <Icon className="h-5 w-5 fill-white/10 stroke-gray-400 transition-colors duration-300 group-hover:fill-emerald-300/10 group-hover:stroke-emerald-400" />
    </div>
  );
}

function Resource({ resource }: { resource: (typeof resources)[number] }) {
  return (
    <HighlightCard
      key={resource.href}
      className="px-6 pb-6 pt-16"
      gridProps={resource.pattern}
    >
      <ResourceIcon icon={resource.icon} />
      <h3 className="mt-4 text-sm font-semibold leading-7 text-white">
        <Link href={resource.href}>
          <span className="absolute inset-0 rounded-2xl" />
          {resource.name}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{resource.description}</p>
    </HighlightCard>
  );
}

export function Resources() {
  return (
    <div className="my-16 xl:max-w-none">
      <h2 id="resources">Resources</h2>
      <div className="not-prose mt-4 grid grid-cols-1 gap-8 border-t border-white/10 pt-10 sm:grid-cols-2 xl:grid-cols-4">
        {resources.map((resource) => (
          <Resource key={resource.href} resource={resource} />
        ))}
      </div>
    </div>
  );
}
