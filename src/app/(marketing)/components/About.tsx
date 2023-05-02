import clsx from "clsx";
import { HighlightCard } from "~/components/Card";
import { SectionTitle } from "./SectionTitle";
import { CheckIcon } from "@heroicons/react/24/solid";

const AboutCard = ({
  className,
  title,
  description,
  imageSrc,
  imageAlt,
  inline,
}: {
  className?: string;
  title: React.ReactNode;
  description: React.ReactNode;
  imageSrc: string;
  imageAlt: string;
  inline?: boolean;
}) => {
  return (
    <HighlightCard
      size="lg"
      className={className}
      gridProps={{
        y: -6,
        squares: [
          [-1, 2],
          [1, 3],
        ],
      }}
    >
      <div
        className={clsx(
          "flex items-center gap-5 text-left lg:gap-8",
          inline ? "flex-col" : "flex-col lg:flex-row"
        )}
      >
        <div className="flex flex-col gap-2 lg:gap-5">
          <h3 className="text-xl font-semibold sm:text-2xl">{title}</h3>
          <div className="text-sm text-gray-300 sm:text-base">
            {description}
          </div>
        </div>
        <img src={imageSrc} alt={imageAlt} />
      </div>
    </HighlightCard>
  );
};

const AboutCardDescriptionList = ({
  points,
}: {
  points: React.ReactNode[];
}) => (
  <ul className="flex flex-col gap-1">
    {points.map((point, index) => (
      <li className="flex items-start gap-2.5" key={index}>
        <CheckIcon className="mt-1.5 h-4 w-4 flex-none text-green-500" />
        {point}
      </li>
    ))}
  </ul>
);

export const About = () => {
  return (
    <section className="px-5 pt-20 sm:pt-24">
      <SectionTitle as="h2">
        Focus on your features without worrying about your APIs
      </SectionTitle>
      <AboutCard
        className="mt-14"
        title="Monitor every single API call"
        description={
          <AboutCardDescriptionList
            points={[
              "Full observability into your API request/responses",
              "Track your server side and client side caches",
              "A clear and concise cache management dashboard",
            ]}
          />
        }
        imageSrc="/assets/images/monitor.png"
        imageAlt="Monitor every single API call"
      />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <AboutCard
          title="Speed up all your APIs"
          description={
            <AboutCardDescriptionList
              points={[
                "Get your response times below 10ms with pre-cached responses from the edge",
                "Avoid annoying rate limits",
                "Bypass 3rd party pay per request APIs",
              ]}
            />
          }
          imageSrc="/assets/images/speed.png"
          imageAlt="From Scooters to Cars"
          inline
        />
        <AboutCard
          title="Improve reliability"
          description={
            <AboutCardDescriptionList
              points={[
                "Recover from temporary problems by serving cached data while we revalidate with automatic background retries",
                "Protect against traffic spikes and downtime",
              ]}
            />
          }
          imageSrc="/assets/images/secure.png"
          imageAlt="Always online"
          inline
        />
      </div>
      <AboutCard
        className="mt-8"
        title="Open source with a one click self host option"
        description={
          <AboutCardDescriptionList
            points={[
              "Self-host your own Putcache instances",
              "Get the same benefits for your own internal APIs and third-party APIs",
              "Never see CORS errors again",
            ]}
          />
        }
        imageSrc="/assets/images/self.png"
        imageAlt="DIY"
      />
    </section>
  );
};
