"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import Typewriter, { TypewriterClass } from "typewriter-effect";
import { Badge } from "~/components/Badge";
import styles from "./HeroExample.module.css";

const scrollYProgressMap = [0, 0.1];

export const HeroExample = () => {
  const [isScaled, setIsScaled] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, {
    amount: 1,
  });
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, scrollYProgressMap, [21.28, 0]);
  const z = useTransform(scrollYProgress, scrollYProgressMap, [-74.56, 0]);
  const rotateX = useTransform(scrollYProgress, scrollYProgressMap, [40, 0]);
  const scale = useTransform(scrollYProgress, scrollYProgressMap, [0.9, 1]);

  useMotionValueEvent(scale, "change", (latest) => {
    if (latest > 0.999) {
      setIsScaled(true);
    } else {
      setIsScaled(false);
    }
  });

  const shouldRun = isScaled && isInView;

  return (
    <>
      <AnimatePresence>
        {shouldRun && (
          <motion.div
            className="pointer-events-none fixed inset-0 bg-transparent backdrop-blur transition"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
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
        <ExampleChat start={shouldRun} />
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

export const ExampleChat = ({ start }: { start: boolean }) => {
  const [instance, setInstance] = useState<TypewriterClass>();
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [currentOutputText, setCurrentOutputText] = useState("");
  const [currentReferences, setCurrentReferences] = useState([]);

  useEffect(() => {
    const currentSample = samples[currentSampleIndex];
    if (instance && start) {
      instance
        .typeString(currentSample.input)
        .callFunction(() => {
          setCurrentOutputText(currentSample.output.text);
        })
        .start();
    }
    if (instance && !start) {
      instance.deleteAll().callFunction(() => {
        setCurrentOutputText("");
        setCurrentReferences([]);
      });
    }
  }, [instance, start, currentSampleIndex]);

  return (
    <section className={styles.container}>
      <section className={styles.window}>
        <div className={styles.input}>
          <Typewriter
            options={{
              delay: 50,
            }}
            onInit={(typewriter) => {
              setInstance(typewriter);
            }}
          />
        </div>
        <div className={styles.loading} />
        <div className={styles.output}>
          <div className={styles.outputText}>{currentOutputText}</div>
          <footer className={styles.outputFooter}>
            <div className="flex gap-2">
              {currentReferences.map((reference) => (
                <Badge key={reference}>{reference}</Badge>
              ))}
            </div>
          </footer>
        </div>
      </section>
    </section>
  );
};
