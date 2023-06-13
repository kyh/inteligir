"use client";

import { useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { cn } from "~/lib/utils/cn";
import { Badge } from "~/components/Badge";
import styles from "./HeroExample.module.css";

const scrollYProgressMap = [0, 0.1];

export const HeroExample = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, {
    amount: 1,
  });
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, scrollYProgressMap, [21.28, 0]);
  const z = useTransform(scrollYProgress, scrollYProgressMap, [-74.56, 0]);
  const rotateX = useTransform(scrollYProgress, scrollYProgressMap, [40, 0]);
  const scale = useTransform(scrollYProgress, scrollYProgressMap, [0.9, 1]);

  return (
    <>
      <div
        className={cn(
          "pointer-events-none fixed inset-0 bg-transparent opacity-0 backdrop-blur transition",
          isInView && "opacity-1"
        )}
      />
      <motion.div
        ref={ref}
        className="mx-auto mt-10 max-w-[900px] px-3 shadow"
        style={{
          transformPerspective: 3312,
          y,
          z,
          rotateX,
          scale,
        }}
      >
        <ExampleChat />
      </motion.div>
    </>
  );
};

const samples = [
  {
    input:
      "I'm writing a story about the gaming industry, who should I talk to?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
  {
    input:
      "I'm writing a story about the gaming industry, who should I talk to?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
  {
    input:
      "I'm writing a story about the gaming industry, who should I talk to?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
];

export const ExampleChat = () => {
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const currentSample = samples[currentSampleIndex];

  return (
    <section className={styles.container}>
      <section className={styles.window}>
        <div className={styles.input}>
          <div className="block">{currentSample.input}</div>
        </div>
        <div className={styles.loading} />
        <div className={styles.output}>
          <div className={styles.outputText}>{currentSample.output.text}</div>
          <footer className={styles.outputFooter}>
            <div className="flex gap-2">
              {currentSample.output.references.map((reference) => (
                <Badge key={reference}>{reference}</Badge>
              ))}
            </div>
          </footer>
        </div>
      </section>
    </section>
  );
};
