import { Avatar, AvatarFallback, AvatarImage } from "~/components/Avatar";

export const Review = () => {
  return (
    <section className="px-5 pt-20 sm:pt-24">
      <hr className="mx-auto h-px w-1/2 border-white/10" />
      <div className="mx-auto max-w-lg py-16 text-center">
        <img
          src="/assets/images/twilio-logo.svg"
          alt="Twilio logo"
          className="mx-auto mb-8 w-[100px]"
        />
        <p className="text-xl font-semibold leading-tight text-gray-100">
          Lorem ipsum dolor sit amet consectetur adipisicing elit. Illum
          reiciendis maiores impedit sequi laudantium neque vitae commodi earum.
        </p>
        <Avatar className="mx-auto mt-10">
          <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
          <AvatarFallback>CN</AvatarFallback>
        </Avatar>
        <p className="mt-1 font-semibold">John Boggs</p>
        <p className="whitespace-nowrap text-sm text-gray-400">
          Principal Software Engineer
        </p>
      </div>
      <hr className="mx-auto h-px w-1/2 border-white/10" />
    </section>
  );
};
