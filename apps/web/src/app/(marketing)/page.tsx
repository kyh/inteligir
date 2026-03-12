import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className=" text-white/70">
          Inteligir is an AI agent that manages your
          tasks, coordinates your workflows, and keeps everything on track
          &mdash; all from a desktop app that runs locally on your machine.
        </p>
      </div>
      <WaitlistForm />
    </main>
  );
};

export default Page;
