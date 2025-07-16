import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-4">
      <h1>Make lifelong learning as natural as checking your phone.</h1>
      <p>
        Turn your social feed into your personal university. Inteligir
        transforms trending topics from your world into engaging, bite-sized
        lessons delivered right to your phone.
      </p>
      <div className="flex flex-col gap-2">
        <p>Join the waitlist:</p>
        <WaitlistForm />
      </div>
      <div className="mt-3">
        <p>How it works:</p>
        <ol className="mt-2 list-inside list-decimal">
          <li>Connect your social accounts (or your favorite news feeds)</li>
          <li>Our AI identifies trending topics you care about</li>
          <li>Receive personalized deep dives on the trending topics</li>
        </ol>
      </div>
      <p>
        Perfect for curious minds who want to stay informed without information
        overload. Whether it's the latest AI breakthrough, market trends, or
        cultural phenomena – learn about what's happening in your world,
        explained clearly and concisely.
      </p>
    </main>
  );
};

export default Page;
