"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  ApertureIcon,
  AppWindowIcon,
  BracesIcon,
  CheckIcon,
  ClipboardCheckIcon,
  EyeIcon,
  GithubIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  SearchIcon,
  UploadIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import colors from "tailwindcss/colors";
import { cn } from "~/lib/utils/cn";
import { HighlightCard } from "~/components/Card";
import { Logo } from "~/components/Logo";
import { Text } from "~/components/Text";

const AboutCard = ({
  className,
  title,
  description,
  inline,
  pattern,
  children,
}: {
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  inline?: boolean;
  pattern?: React.ReactNode;
  children?: React.ReactNode;
}) => {
  return (
    <HighlightCard
      size="lg"
      className={cn("grow", className)}
      pattern={pattern}
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
          "flex h-full items-center gap-5 text-center lg:gap-8 lg:text-start",
          inline ? "flex-col" : "flex-col lg:flex-row"
        )}
      >
        <div className="flex flex-col gap-2 lg:gap-5">
          <h3 className="text-xl font-semibold sm:text-2xl">{title}</h3>
          <div className="text-start text-sm text-zinc-300 sm:text-base">
            {description}
          </div>
        </div>
        {children}
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
  const sourcesContainerRef = useRef<HTMLDivElement>(null);
  const [sourcesContainerDimensions, setSourcesContainerDimensions] = useState({
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!sourcesContainerRef.current) {
        return;
      }

      const sourcesContainerRect =
        sourcesContainerRef.current?.getBoundingClientRect();

      const width = sourcesContainerRect?.width || 0;
      const height = sourcesContainerRect?.height || 0;

      setSourcesContainerDimensions({
        width,
        height,
      });
    });

    sourcesContainerRef.current &&
      observer.observe(sourcesContainerRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section className="px-5 pt-20 sm:pt-24">
      <Text as="h2" variant="heading1" className="mx-auto mt-3 max-w-xl">
        You bring the knowledge base and we&apos;ll handle everything else.
      </Text>
      <AboutCard
        className="mt-14"
        title="Plug 'n Play"
        description={
          <ol className="ml-5 flex list-decimal flex-col gap-1">
            <li>Connect your knowledge base</li>
            <li>Train your custom model</li>
            <li>Integrate with your workflow</li>
          </ol>
        }
      ></AboutCard>
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <AboutCard
          title="Ultra relevant results"
          description={
            <AboutCardDescriptionList
              points={[
                "References are provided to prevent hallucinations",
                "Customize your model for even more relevant results",
              ]}
            />
          }
          inline
        >
          <div className="relative h-80 w-full rounded-2xl border border-dashed border-zinc-700">
            <SearchIcon className="absolute left-6 top-4 h-4 w-4 text-zinc-700" />
            <XIcon className="absolute right-6 top-4 h-4 w-4 text-zinc-700" />
            <p className="absolute left-12 top-[14px] text-sm text-zinc-700">
              Ask me anything...
            </p>
            <div className="absolute inset-x-4 inset-y-0 z-10 border-x border-dashed border-zinc-700" />
            <div className="absolute inset-x-0 top-0 h-12 border-b border-dashed border-zinc-700" />
            <div className="absolute inset-x-0 bottom-0 z-0 flex h-10 flex-row items-center gap-2 overflow-hidden border-t border-dashed border-zinc-700 px-6 text-xs text-zinc-700">
              <div className="whitespace-nowrap rounded-md border border-dashed border-zinc-700 px-2 py-1">
                Reference 1
              </div>
              <div className="whitespace-nowrap rounded-md border border-dashed border-zinc-700 px-2 py-1">
                Reference 2
              </div>
            </div>
            <div className="absolute inset-x-8 inset-y-16 flex animate-pulse flex-col gap-4">
              <div className="h-2 w-4/5 rounded bg-zinc-700" />
              <div className="h-2 w-2/3 rounded bg-zinc-700" />
              <div className="h-2 w-1/3 rounded bg-zinc-700" />
              <div className="h-2 w-1/2 rounded bg-zinc-700" />
            </div>
          </div>
        </AboutCard>
        <AboutCard
          className="overflow-hidden text-xs"
          title="Private and secure by default"
          description={
            <AboutCardDescriptionList
              points={[
                "Built in permission and access control",
                "End to end encryption",
                "BYO database, model, or interface",
              ]}
            />
          }
          pattern={
            <div className="pointer-events-none absolute left-0 top-0 w-full break-all bg-gradient-to-b from-transparent to-zinc-800 bg-clip-text font-mono text-xs leading-4 tracking-[4px] text-transparent">
              0000101001010011011001010110001101110101011100100110100101110100011110010010000001100001011011100110010000100000010100000111001001101001011101100110000101100011011110010000101001010000011100100110100101110110011000010110001101111001001000000110000101101110011001000010000001110011011001010110001101110101011100100110100101110100011110010010000001100001011100100110010100100000011101000110111101101111001000000110100101101101011100000110111101110010011101000110000101101110011101000010000001100110011011110111001000100000011011000110010101100111011000010110110001100101011100110110010100100000010000110110110001100001011110010010000001100100011011110110010101110011001000000110111001101111011101000010000000001010010100110110010101100011011101010111001001101001011101000111100100100000011000010110111001100100001000000101000001110010011010010111011001100001011000110111100100001010010100000111001001101001011101100110000101100011011110010010000001100001011011100110010000100000011100110110010101100011011101010111001001101001011101000111100100100000011000010111001001100101001000000111010001101111011011110010000001101001011011010111000001101111011100100111010001100001011011100111010000100000011001100110111101110010001000000110110001100101011001110110000101101100011001010111001101100101001000000100001101101100011000010111100100100000011001000110111101100101011100110010000001101110011011110111010000100000000010100101001101100101011000110111010101110010011010010111010001111001001000000110000101101110011001000010000001010000011100100110100101110110011000010110001101111001000010100101000001110010011010010111011001100001011000110111100100100000011000010110111001100110111101110010001000000110110001100101011001110110000101101100011001010111001101100101001000000100001101101100011000010111100100100000011001000110111101100101011100110010000001101110011011110111010000100000000010100101001101100101011000110111010101110010011010010111010001111001001000000110000101101110011001000010000001010000011100100110100101110110011000010110001101111001000010100101000001110010011010010111011001100001011000110111100100100000011000010110110100110100101110110011000010110001101111001001000000110000101101101001101001011101100110000101100011011110010010000001100001011011
            </div>
          }
          inline
        >
          <div className="mt-10 grid w-full grid-cols-3 gap-5">
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={KeyIcon} />
              Secure
            </div>
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={LockIcon} />
              Encrypted
            </div>
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={EyeIcon} />
              Transparent
            </div>
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={ClipboardCheckIcon} />
              Compliant
            </div>
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={UserIcon} />
              Access Control
            </div>
            <div className="flex flex-col items-center">
              <SourceIcon className="rounded" Icon={EyeIcon} />
              Transparent
            </div>
          </div>
        </AboutCard>
      </div>
      <AboutCard
        className="mt-8"
        title="We'll go where you go"
        description={
          <AboutCardDescriptionList
            points={[
              "Direct data integrations with the tools you already use",
              "Multi-platform to work where you work",
            ]}
          />
        }
      >
        <div className="flex grow items-center justify-center overflow-hidden">
          <div className="max-h-[320px]">
            <div className="grid grid-cols-4 items-center justify-center gap-4">
              <SourceIcon id="notion" />
              <SourceIcon id="drive" />
              <SourceIcon id="dropbox" />
              <SourceIcon id="wordpress" />
              <SourceIcon id="linear" />
              <SourceIcon id="jira" />
              <SourceIcon id="airtable" />
              <SourceIcon id="markdown" />
              <SourceIcon Icon={GlobeIcon} />
              <SourceIcon Icon={GithubIcon} />
              <SourceIcon id="zendesk" />
              <SourceIcon Icon={UploadIcon} />
            </div>
            <div className="w-full px-5">
              <div ref={sourcesContainerRef}>
                <Lines
                  width={sourcesContainerDimensions.width}
                  height={100}
                  radius={5}
                  strokeWidth={1}
                  highlightStrokeWidth={2}
                  strokeDasharray={2}
                />
              </div>
              <div className="flex justify-center">
                <div className="rounded-full p-3 text-white shadow-highlight">
                  <Logo className="h-5 w-5" />
                </div>
              </div>
              <Lines
                width={sourcesContainerDimensions.width}
                height={100}
                radius={5}
                strokeWidth={1}
                highlightStrokeWidth={2}
                strokeDasharray={2}
                invert
              />
            </div>
            <div className="grid grid-cols-4 items-center justify-center gap-4">
              <SourceIcon Icon={AppWindowIcon} />
              <SourceIcon Icon={BracesIcon} />
              <SourceIcon id="slack" />
              <SourceIcon Icon={ApertureIcon} />
            </div>
          </div>
        </div>
      </AboutCard>
    </section>
  );
};

const SourceIcon = ({
  Icon,
  id,
  className,
}: {
  Icon?: React.JSXElementConstructor<any>;
  id?: string;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "inline-flex justify-center rounded-full border border-dashed border-zinc-700 bg-zinc-900 p-3 text-white",
        className
      )}
    >
      {Icon && <Icon className="h-5 w-5" />}
      {id && (
        <Image
          alt={id}
          width={20}
          height={20}
          className="h-5 w-5"
          src={`/assets/icons/${id}.svg`}
        />
      )}
    </div>
  );
};

const Lines = ({
  className,
  width,
  height,
  radius,
  strokeWidth,
  highlightStrokeWidth,
  strokeDasharray,
  invert,
}: {
  className?: string;
  width: number;
  height: number;
  radius: number;
  strokeWidth: number;
  highlightStrokeWidth: number;
  strokeDasharray: number;
  invert?: boolean;
}) => {
  const topLinesHeight = Math.round(height / 3);
  const bottomLineHeight = height - topLinesHeight;
  const thirdWidth = Math.round(width / 3);
  const halfWidth = Math.round(width / 2);
  const sixthWidth = Math.round(width / 6);

  const path = `M1 0v${
    topLinesHeight - radius
  }a${radius} ${radius} 0 00${radius} ${radius}h${halfWidth - radius}M${
    width - 1
  } 0v${topLinesHeight - radius}a${radius} ${radius} 0 01-${radius} ${radius}H${
    halfWidth + 1
  }v${bottomLineHeight}m-${sixthWidth} -${height}v${topLinesHeight}m${thirdWidth} -${topLinesHeight}v${topLinesHeight}`;

  const animate = invert
    ? {
        x1: [0, 0],
        y1: [2.5 * height, -2 * height],
        x2: [0, 0],
        y2: [2 * height, -2.5 * height],
      }
    : {
        x1: [0, 0],
        y1: [-2.5 * height, 2 * height],
        x2: [0, 0],
        y2: [-2 * height, 2.5 * height],
      };

  const animateId = `pulse-${invert ? "inverted" : "normal"}`;

  return (
    <svg
      className={cn(invert && "rotate-180", className)}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
    >
      <path
        d={path}
        stroke="#ffffff20"
        strokeDasharray={strokeDasharray}
        strokeWidth={strokeWidth}
      />
      <path
        d={path}
        stroke={`url(#${animateId})`}
        strokeLinecap="round"
        strokeWidth={highlightStrokeWidth}
        strokeDasharray={strokeDasharray}
      />
      <defs>
        <motion.linearGradient
          animate={animate}
          transition={{
            duration: 2,
            repeat: Infinity,
          }}
          id={animateId}
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={colors.emerald["500"]} stopOpacity="0" />
          <stop stopColor={colors.emerald["500"]} stopOpacity="0.4" />
          <stop offset="1" stopColor={colors.emerald["500"]} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
};
