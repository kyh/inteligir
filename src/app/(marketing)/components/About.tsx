import { CheckIcon } from "@heroicons/react/24/solid";
import { cn } from "~/lib/utils/cn";
import { HighlightCard } from "~/components/Card";
import { Text } from "~/components/Text";

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
        className={cn(
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
      <Text as="h2" variant="heading1" className="mx-auto mt-3 max-w-xl">
        You bring the knowledge base and we&apos;ll handle everything else.
      </Text>
      <AboutCard
        className="mt-14"
        title="Plug 'n Play"
        description={
          <ul className="flex flex-col gap-1">
            <li className="flex items-start gap-2.5">
              1/ Connect your knowledge base
            </li>
            <li className="flex items-start gap-2.5">
              2/ Train your custom model
            </li>
            <li className="flex items-start gap-2.5">
              3/ Integrate with your workflow
            </li>
          </ul>
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
                "Smart LLM presets with flexible configurations to prevent hallucinations",
                "Customize your model for even more relevant results",
                "Multiplayer mode means there's always a human in the loop",
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
                "BYO* *interface/model/database",
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
              "Over data 100 integrations to train from",
              "Multi-platform prebuilt interfaces to work where you work",
            ]}
          />
        }
        imageSrc="/assets/images/self.png"
        imageAlt="DIY"
      />
    </section>
  );
};
