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
import { cn } from "~/lib/utils/cn";
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
    if (latest > 0.97) {
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
      "Can you provide a changelog of everything shipped in Inteligir this week?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
  {
    input: "Who is responsible for the design of the landing experience?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
  {
    input: "Whats our HR policy on working from home?",
    output: {
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Corporis nisi harum unde tenetur obcaecati quaerat laboriosam reprehenderit totam sequi! Corrupti, commodi odit officia praesentium repellat harum quaerat quia explicabo amet.",
      references: ["Reference 1", "Reference 2"],
    },
  },
];

export const ExampleChat = ({ start }: { start: boolean }) => {
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [showQuestion, setShowQuestion] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);

  const currentSample = samples[currentSampleIndex];

  return (
    <section className={styles.container}>
      <section className={styles.window}>
        <div className={styles.input}>
          <Typewriter
            start={start && showQuestion}
            text={currentSample.input}
            onTyped={() => setShowAnswer(true)}
            onCleared={() => setShowAnswer(false)}
          />
        </div>
        <div className={cn(styles.loading, showAnswer && styles.active)} />
        <div className={styles.output}>
          <div className={styles.outputText}>
            {showAnswer && currentSample.output.text}
          </div>
          <footer className={styles.outputFooter}>
            <div className="flex gap-2">
              {showAnswer &&
                currentSample.output.references.map((reference) => (
                  <Badge key={reference}>{reference}</Badge>
                ))}
            </div>
            <button
              className="hidden"
              onClick={() => {
                setShowQuestion(false);
                setTimeout(() => {
                  setCurrentSampleIndex(
                    (currentSampleIndex + 1) % samples.length
                  );
                  setShowQuestion(true);
                }, 1000);
              }}
            >
              next
            </button>
          </footer>
        </div>
      </section>
    </section>
  );
};

const Typewriter = ({
  start,
  text,
  onTyped,
  onCleared,
}: {
  start: boolean;
  text: string;
  onTyped?: () => void;
  onCleared?: () => void;
}) => {
  const textContainerRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    let i = 0;

    const write = () => {
      if (!textContainerRef.current || finishedRef.current) return;
      if (i < text.length) {
        animatingRef.current = true;
        textContainerRef.current.innerHTML = text.substring(0, i + 1);
        i++;
        setTimeout(write, 50);
      } else {
        animatingRef.current = false;
        finishedRef.current = true;
        i = 0;
        onTyped?.();
      }
    };

    const clear = () => {
      if (!textContainerRef.current || !finishedRef.current) return;
      if (i < text.length) {
        animatingRef.current = true;
        textContainerRef.current.innerHTML = text.substring(0, text.length - i);
        i++;
        setTimeout(clear, 5);
      } else {
        animatingRef.current = false;
        finishedRef.current = false;
        i = 0;
        textContainerRef.current.innerHTML = "";
        onCleared?.();
      }
    };

    if (animatingRef.current) return;

    if (start) {
      write();
    } else {
      clear();
    }
  }, [textContainerRef, start, text, onTyped, onCleared]);

  return (
    <div>
      <span ref={textContainerRef} />
      <span className={styles.cursor}>|</span>
    </div>
  );
};
