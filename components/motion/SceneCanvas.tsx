"use client";

import { Canvas, type CanvasProps } from "@react-three/fiber";

// Imported only inside lazy scene modules, never by the static page shell.
export default function SceneCanvas(props: CanvasProps) {
  return (
    <Canvas
      dpr={1}
      gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
      fallback={<span />}
      {...props}
    />
  );
}
