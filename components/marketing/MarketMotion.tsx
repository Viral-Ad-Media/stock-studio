"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useMotionVisibility } from "@/components/motion/useMotionVisibility";
import MotionBoundary from "@/components/motion/MotionBoundary";
import MotionToggle from "@/components/motion/MotionToggle";

// Keep WebGL and its dependencies out of the initial marketing render.
const Scene = dynamic(() => import("./MarketScene"), {
  ssr: false,
  loading: () => null,
});

export default function MarketMotion() {
  const { containerRef, visible } = useMotionVisibility(1024);
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div
        ref={containerRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-35"
      >
        {visible && !paused && (
          <MotionBoundary>
            <Scene />
          </MotionBoundary>
        )}
      </div>
      {visible && (
        <MotionToggle
          paused={paused}
          onToggle={() => setPaused((v) => !v)}
          label="background animation"
          className="absolute bottom-3 right-6 z-10 rounded border border-ink-600 bg-ink-900/90 px-2 py-1 text-xs text-fg-subtle hover:text-slate-100"
        />
      )}
    </>
  );
}
