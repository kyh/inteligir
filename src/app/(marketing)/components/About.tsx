import { CheckIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { HighlightCard } from "~/components/Card";
import { SectionTitle } from "./SectionTitle";

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
          <div className="text-sm text-zinc-300 sm:text-base">
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
        You bring the knowledge base and we&apos;ll handle everything else.
      </SectionTitle>
      <AboutCard
        className="mt-14"
        title="Plug 'n Play"
        description={
          <AboutCardDescriptionList
            points={[
              "Connect your knowledge base",
              "Train your custom model",
              "Smart presets with flexible configurations",
            ]}
          />
        }
        imageSrc="/assets/images/monitor.png"
        imageAlt="Set up in less than 2 minutes"
      />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <AboutCard
          title="Ultra relevant results"
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
          title="Private and secure by default"
          description={
            <AboutCardDescriptionList
              points={[
                "Built in permission and access control",
                "End to end encryption",
                "Compose our service with yours -- bring your own interface/model/database",
              ]}
            />
          }
          imageSrc="/assets/images/secure.png"
          imageAlt="Privacy and Security by default"
          inline
        />
      </div>
      <AboutCard
        className="mt-8"
        title="We'll go where you go"
        description={
          <AboutCardDescriptionList
            points={[
              "One click self host option",
              "Compose our service with yours -- bring your own interface/model/database",
              "",
            ]}
          />
        }
        imageSrc="/assets/images/self.png"
        imageAlt="DIY"
      />
    </section>
  );
};
