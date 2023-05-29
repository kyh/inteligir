import { PrimaryButton } from "./HomeButton";

export const GetStarted = () => {
  return (
    <section className="px-5 py-20 sm:py-24">
      <article className="relative mx-auto rounded-2xl bg-zinc-900/50 px-8 py-16 text-center shadow-highlight">
        <div className="bg-gradient-ball absolute left-1/2 top-6 -z-10 h-[260px] w-1/2 -translate-x-1/2" />
        <h2 className="mx-auto max-w-xl text-3xl font-semibold leading-none sm:text-4xl">
          Get started today
        </h2>
        <p className="mt-2 text-sm text-zinc-400 sm:text-base">
          Speed up your applications in less than 5 minutes.
        </p>
        <div className="my-5 grid items-start justify-center">
          <PrimaryButton>Request early access</PrimaryButton>
        </div>
        <button className="text-sm hover:underline">
          Already have an account?
        </button>
      </article>
    </section>
  );
};
