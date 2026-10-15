"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useMotionVisibility } from "@/components/motion/useMotionVisibility";
import MotionBoundary from "@/components/motion/MotionBoundary";
import MotionToggle from "@/components/motion/MotionToggle";

export type GuideStage = "workspace" | "research" | "thesis" | "journal";
const Scene = dynamic(() => import("./GuideScene"), {
  ssr: false,
  loading: () => null,
});
const stages = ["research", "thesis", "journal"] as const;
export default function GuideVisual({
  stage = "workspace",
}: {
  stage?: GuideStage;
}) {
  const { containerRef, visible } = useMotionVisibility();
  const [paused, setPaused] = useState(false);
  return (
    <figure className="my-4 overflow-hidden rounded-xl border border-ink-700 bg-ink-950/60">
      <div ref={containerRef} className="relative h-32" aria-hidden="true">
        <div className="absolute inset-0 flex items-center justify-center gap-3 p-5">
          {[0, 1, 2].map((n) => (
            <div
              key={n}
              className="h-16 w-16 rounded-lg border border-emerald-500/25 bg-emerald-500/5"
              style={{
                transform: `perspective(400px) rotateY(-18deg) translateY(${(n - 1) * -5}px)`,
              }}
            >
              <div className="m-3 h-1 rounded bg-emerald-400/40" />
              <div className="mx-3 mt-2 h-1 rounded bg-slate-500/30" />
              <div className="mx-3 mt-2 h-1 w-5 rounded bg-slate-500/30" />
            </div>
          ))}
        </div>
        {visible && !paused && (
          <div className="absolute inset-0">
            <MotionBoundary>
              <Scene stage={stage} />
            </MotionBoundary>
          </div>
        )}
      </div>
      <figcaption className="border-t border-ink-700 px-3 py-2">
        <ol
          className="flex items-center justify-between gap-2 text-[11px]"
          aria-label="Research workflow"
        >
          {stages.map((s, n) => (
            <li
              key={s}
              className={
                stage === s
                  ? "font-semibold text-emerald-400"
                  : "text-fg-subtle"
              }
            >
              {n + 1}. {s[0].toUpperCase() + s.slice(1)}
            </li>
          ))}
        </ol>
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-fg-subtle">
          <span>Illustrative workspace · sample cards</span>
          {visible && (
            <MotionToggle
              paused={paused}
              onToggle={() => setPaused((v) => !v)}
            />
          )}
        </div>
      </figcaption>
    </figure>
  );
}
