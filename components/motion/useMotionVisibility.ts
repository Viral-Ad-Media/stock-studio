"use client";

import { useEffect, useRef, useState } from "react";

/** Run optional motion only on suitable screens while its container is visible. */
export function useMotionVisibility(minWidth = 640) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const media = matchMedia(
      `(min-width: ${minWidth}px) and (prefers-reduced-motion: no-preference)`,
    );
    let intersecting = false;
    const sync = () =>
      setVisible(media.matches && intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      sync();
    });
    if (containerRef.current) observer.observe(containerRef.current);
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [minWidth]);

  return { containerRef, visible };
}
