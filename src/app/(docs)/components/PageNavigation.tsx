import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { Button } from "~/components/Button";
import { navigation } from "./SideNavigation";

function PageLink({
  label,
  page,
  previous = false,
}: {
  label: string;
  page: (typeof navigation)[0]["links"][0];
  previous?: boolean;
}) {
  return (
    <>
      <Button
        as={Link}
        href={page.href}
        aria-label={`${label}: ${page.title}`}
        size="sm"
      >
        {previous && <ArrowLeftIcon className="mr-1 h-4 w-4" />}
        {label}
        {!previous && <ArrowRightIcon className="ml-1 h-4 w-4" />}
      </Button>
      <Link
        href={page.href}
        tabIndex={-1}
        aria-hidden="true"
        className="text-base font-semibold text-zinc-900 transition hover:text-zinc-600 dark:text-white dark:hover:text-zinc-300"
      >
        {page.title}
      </Link>
    </>
  );
}

export function PageNavigation() {
  const pathName = usePathname();
  const allPages = navigation.flatMap((group) => group.links);
  const currentPageIndex = allPages.findIndex((page) => page.href === pathName);

  if (currentPageIndex === -1) {
    return null;
  }

  const previousPage = allPages[currentPageIndex - 1];
  const nextPage = allPages[currentPageIndex + 1];

  if (!previousPage && !nextPage) {
    return null;
  }

  return (
    <div className="flex">
      {previousPage && (
        <div className="flex flex-col items-start gap-3">
          <PageLink label="Previous" page={previousPage} previous />
        </div>
      )}
      {nextPage && (
        <div className="ml-auto flex flex-col items-end gap-3">
          <PageLink label="Next" page={nextPage} />
        </div>
      )}
    </div>
  );
}
