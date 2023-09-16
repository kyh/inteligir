import Shell from "./Shell";

export default function SettingsShell({
  allTeams,
  team,
  children,
  title,
  description,
  profile,
}: {
  allTeams: Team[];
  team: Team;
  children: React.ReactNode;
  title: string;
  description: string;
  profile: Profile;
}) {
  return (
    <Shell
      team={team}
      allTeams={allTeams}
      pageName="Settings"
      subpage={title}
      subtitle={description}
      childrenClassname="max-w-5xl"
      profile={profile}
    >
      <div className="mx-auto grid h-full w-full">
        <div className="py-4">{children}</div>
      </div>
    </Shell>
  );
}
