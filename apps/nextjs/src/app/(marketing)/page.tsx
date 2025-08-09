import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-4">
      <h1>The next gen of docs.</h1>
      <p>
        An adaptive and intelligent block-based editor that connects with your
        proprietary data and helps you generate content, visualizations, and
        custom interfaces.
      </p>
      <WaitlistForm />
    </main>
  );
};

export default Page;
