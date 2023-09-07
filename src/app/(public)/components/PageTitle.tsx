import TwitterFollowButton from "./TwitterFollowButton";

export default function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-20 flex flex-col justify-between gap-4 md:mt-28 md:mb-12 md:flex-row md:items-center">
      <h1 className="text-4xl font-bold md:text-5xl">{children}</h1>
      <TwitterFollowButton />
    </div>
  );
}
