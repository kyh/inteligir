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
      <p>How it works:</p>
      <ol className="list-inside list-decimal">
        <li>Connect your social accounts (or any news feed)</li>
        <li>Our AI identifies trending topics you care about</li>
        <li>Receive personalized 5-minute lessons daily</li>
        <li>Dive deeper with curated sources and references</li>
      </ol>
      <p>
        Perfect for curious minds who want to stay informed without information
        overload. Whether it's the latest AI breakthrough, market trends, or
        cultural phenomena – learn about what's happening in your world,
        explained clearly and concisely.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <p>Join the waitlist:</p>
        <WaitlistForm />
      </div>
    </main>
  );
};

export default Page;
