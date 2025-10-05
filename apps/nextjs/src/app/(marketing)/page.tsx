import { WaitlistForm } from "./_components/waitlist-form";

const Page = () => {
  return (
    <main className="mt-8 flex flex-col gap-4">
      <h1>Open source alternative to Exa Websets</h1>
      <p>
        Create, manage, and share powerful web search collections. OpenWebsets
        gives you the tools to organize your research, build knowledge bases,
        and collaborate on curated web content - all with complete control over your data.
      </p>
      <WaitlistForm />
      <div className="mt-3">
        <p>Key features:</p>
        <ol className="mt-2 list-inside list-decimal">
          <li>Create and organize web search collections</li>
          <li>Collaborate and share collections with others</li>
          <li>Advanced search and filtering capabilities</li>
          <li>Export and import collection data</li>
        </ol>
      </div>
      <p>
        Perfect for researchers, content creators, and teams who need to organize
        web research. Whether you're building a knowledge base, curating resources
        for a project, or collaborating on research - OpenWebsets provides the
        open source foundation you need.
      </p>
      <div className="mt-4 p-4 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">
          <strong>Inspired by:</strong> <a href="https://exa.ai/websets" className="underline hover:no-underline" target="_blank" rel="noopener noreferrer">Exa Websets</a> and <a href="https://juicebox.ai/" className="underline hover:no-underline" target="_blank" rel="noopener noreferrer">Juicebox.ai</a>
        </p>
      </div>
    </main>
  );
};

export default Page;
