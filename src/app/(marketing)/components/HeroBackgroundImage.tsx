"use client";

import { motion, useScroll, useTransform } from "framer-motion";

const scrollYProgressMap = [0, 0.1];

export const HeroBackgroundImage = () => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, scrollYProgressMap, [21.28, 0]);
  const z = useTransform(scrollYProgress, scrollYProgressMap, [-74.56, 0]);
  const rotateX = useTransform(scrollYProgress, scrollYProgressMap, [40, 0]);
  const scale = useTransform(scrollYProgress, scrollYProgressMap, [0.9, 1]);

  return (
    <motion.img
      className="mx-auto mt-10 rounded-md border-2 border-border shadow backdrop-blur-lg sm:w-[600px] md:w-[900px]"
      src="/assets/images/dashboard.png"
      alt="dashboard"
      style={{
        transformPerspective: 3312,
        y,
        z,
        rotateX,
        scale,
      }}
    />
  );
};
