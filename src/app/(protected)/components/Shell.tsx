"use client";
import Sidebar from "./Sidebar";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
import { ChevronRight, Menu } from "lucide-react";
import { useState } from "react";

export default function Shell({
  team,
  allTeams,
  children,
  pageName,
  subpage,
  subtitle,
  childrenClassname,
  profile,
}: {
  team: Team;
  allTeams: Team[];
  children: React.ReactNode;
  pageName: string;
  subpage?: string;
  subtitle: string;
  childrenClassname?: string;
  profile: Profile;
}) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen">
      <div className="hidden shrink-0 grow-0 md:block md:w-[320px]">
        <Sidebar user={profile} team={team} allTeams={allTeams} />
      </div>
      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 h-full w-full animate-fadeIn bg-gray-500 opacity-50"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-2/3 max-w-[320px] animate-slideRightAndFadeIn">
            <Sidebar user={profile} team={team} allTeams={allTeams} />
          </div>
        </>
      )}
      <div className="flex flex-col h-full w-full overflow-auto bg-white">
        <div className="flex h-20 w-full flex-col justify-center border-b border-gray-200 bg-white px-4 md:px-8">
          <div className="flex items-center">
            <Button
              variant="ghost"
              className="mr-2 md:hidden"
              onClick={() => setMobileSidebarOpen((x) => !x)}
            >
              <Menu />
            </Button>
            <h1
              className={cn("text-lg font-medium", {
                "text-gray-700": !!subpage,
              })}
            >
              {pageName}
            </h1>
            {subpage && (
              <>
                <ChevronRight className="mx-1 w-4 text-gray-400" />
                <h2 className="text-lg font-medium">{subpage}</h2>
              </>
            )}
          </div>
          <h2 className="hidden text-base text-gray-500 md:block">
            {subtitle}
          </h2>
        </div>
        <section
          className={cn(
            "relative flex flex-grow p-4 md:p-8",
            childrenClassname
          )}
        >
          {children}
        </section>
      </div>
    </div>
  );
}
