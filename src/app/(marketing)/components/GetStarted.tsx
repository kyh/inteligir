import { SecondaryButton } from "./HomeButton";

export const GetStarted = () => {
  return (
    <section className="px-5 pb-20 pt-20 sm:pb-24 sm:pt-24">
      <article className="shadow-highlight relative mx-auto rounded-2xl bg-gray-900/50 px-8 py-16 text-center">
        <div className="bg-gradient-ball absolute left-1/2 top-6 -z-10 h-[260px] w-1/2 -translate-x-1/2" />
        <h2 className="mx-auto max-w-xl text-3xl font-semibold leading-none sm:text-4xl">
          Get started today
        </h2>
        <p className="mt-2 text-sm text-gray-400 sm:text-base">
          Speed up your applications in less than 5 minutes.
        </p>
        <SecondaryButton>Request Early Access</SecondaryButton>
          <button className="text-sm hover:underline">
            Already have an account?
          </button>
      </article>
    </section>
  );
};
