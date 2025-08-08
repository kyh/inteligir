import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-4">
      <h1>The next gen of docs</h1>
      <p>
        An intelligent block-based editor that connects with your proprietary
        data and helps you generate content, charts, summaries, and insights
      </p>
      <div className="flex flex-col gap-2">
        <p>Join the waitlist:</p>
        <WaitlistForm />
      </div>
    </main>
  );
};

export default Page;
