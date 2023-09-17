import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "ui/components/collapsible";
import Logo from "ui/components/logo";
import { cn } from "ui/lib/cn";
import type { LucideIcon } from "ui/icons";
import { ChevronDown, Home, Settings } from "ui/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "ui/components/button";
import { Separator } from "ui/components/separator";
import TeamSelector from "./TeamSelector";
import UserProfileButton from "./UserProfileDropdown";

interface Step {
  id: string;
  name: string;
  href: string;
}

interface StepsProps {
  steps: Step[];
  activeStepId: string;
}

const Steps: React.FC<StepsProps> = ({ steps, activeStepId }) => {
  return (
    <div className="relative flex w-full flex-col py-2">
      <div className="absolute bottom-[25px] left-[15px] top-[28px] border-l border-gray-200 py-2" />
      <div className="flex flex-col space-y-1">
        {steps.map((step) => (
          <div key={step.id} className={cn(`ml-4 flex items-center`)}>
            <div
              className={cn(`z-10 -ml-[3.5px] mr-2 h-1.5 w-1.5 rounded-full`, {
                "bg-black font-semibold": step.id === activeStepId,
                "bg-gray-200 font-normal": step.id !== activeStepId,
              })}
            />
            <Link href={step.href} className="w-full">
              <Button
                variant={"link"}
                size="sm"
                className={cn("block w-full py-1 text-left", {
                  "font-semibold text-black": step.id === activeStepId,
                  "font-normal text-gray-500": step.id !== activeStepId,
                })}
              >
                {step.name}
              </Button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

const Option = ({
  icon: Icon,
  title,
  pathname,
  expansion = { allowed: false, expanded: false },
}: {
  icon: LucideIcon;
  title: string;
  pathname: string;
  expansion?: {
    allowed: boolean;
    expanded: boolean;
  };
}) => {
  const currentPathname = usePathname();

  return (
    <div className="flex w-full items-center justify-between rounded-md p-2 font-medium transition hover:bg-gray-200">
      <div
        className={cn("flex items-center text-gray-700", {
          "font-semibold text-gray-900": currentPathname === pathname,
        })}
      >
        <Icon className="mr-2 w-4" />
        <span>{title}</span>
      </div>
      {expansion.allowed && (
        <ChevronDown
          className={cn("w-4 text-gray-500 transition", {
            "rotate-180 transform": expansion.expanded,
          })}
        />
      )}
    </div>
  );
};

export default function Sidebar({
  team,
  allTeams,
  user,
}: {
  team: Team;
  allTeams: Team[];
  user: Profile;
}) {
  const pathname = usePathname();

  const [settingsExpanded, setSettingsExpanded] = useState(
    pathname.includes("/settings"),
  );

  return (
    <nav className="flex h-full w-full flex-col border-r border-gray-200 bg-gray-100 py-4">
      <div className="flex h-full flex-col space-y-6 px-4">
        <Logo variant="wordmark" className="my-12" />
        <TeamSelector team={team} allTeams={allTeams} />
        <div className="flex cursor-pointer flex-col">
          <Link href={`/${team.id}`}>
            <Option title="Home" icon={Home} pathname={`/${team.id}`} />
          </Link>
          <Collapsible
            open={settingsExpanded}
            onOpenChange={setSettingsExpanded}
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between">
              <Option
                title="Settings"
                icon={Settings}
                pathname="/[team]/settings"
                expansion={{
                  allowed: true,
                  expanded: settingsExpanded,
                }}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col items-start pl-2">
              <Steps
                activeStepId={pathname.replaceAll(`/${team.id}/settings/`, "")}
                steps={["General", "Members", "Billing"].map((pageName) => {
                  return {
                    id: pageName.toLowerCase(),
                    name: pageName,
                    href: `/${team.id}/settings/${pageName.toLowerCase()}`,
                  };
                })}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
      <Separator className="m-4" />
      <div className="px-4 py-2">
        <UserProfileButton team={team} user={user} />
      </div>
    </nav>
  );
}
