/**
 * Measured Terrain visual system: purposeful index-like entrances, never decorative fading.
 */
import { motion, useReducedMotion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  delay?: number;
  children: ReactNode;
}

export default function Reveal({ children, delay = 0, className = "", ...props }: RevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.26 }}
      transition={{ duration: 0.62, delay, ease: [0.23, 1, 0.32, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
