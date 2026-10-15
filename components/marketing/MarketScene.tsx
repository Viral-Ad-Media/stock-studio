"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import SceneCanvas from "@/components/motion/SceneCanvas";
import { Float, RoundedBox, Line } from "@react-three/drei";
import { MathUtils, type Group } from "three";

// Abstract research architecture, not a financial chart or market data.
function ResearchStructure() {
  const group = useRef<Group>(null);
  useFrame(({ clock, pointer }, delta) => {
    if (!group.current) return;
    group.current.rotation.y = MathUtils.damp(
      group.current.rotation.y,
      -0.3 + pointer.x * 0.12,
      3,
      delta,
    );
    group.current.rotation.x = MathUtils.damp(
      group.current.rotation.x,
      0.15 + pointer.y * 0.06,
      3,
      delta,
    );
    group.current.position.y = Math.sin(clock.elapsedTime * 0.3) * 0.1;
  });
  return (
    <group ref={group} position={[2.4, 0, 0]}>
      <Float speed={1} rotationIntensity={0.12} floatIntensity={0.25}>
        {[0, 1, 2, 3].map((n) => (
          <group
            key={n}
            position={[
              (n % 2) * 1.5 - 0.75,
              Math.floor(n / 2) * 1.5 - 0.75,
              n * -0.12,
            ]}
          >
            <RoundedBox args={[1.15, 1.15, 0.12]} radius={0.08} smoothness={3}>
              <meshStandardMaterial
                color={n % 2 ? "#38bdf8" : "#34d399"}
                transparent
                opacity={0.24}
                metalness={0.3}
                roughness={0.45}
              />
            </RoundedBox>
            <Line
              points={[
                [-0.4, -0.2, 0.08],
                [-0.15, 0.1, 0.08],
                [0.1, -0.05, 0.08],
                [0.4, 0.25, 0.08],
              ]}
              color={n % 2 ? "#7dd3fc" : "#6ee7b7"}
              lineWidth={1.5}
            />
          </group>
        ))}
        <Line
          points={[
            [-1.6, -1.6, -0.3],
            [1.6, -1.6, -0.3],
            [1.6, 1.6, -0.3],
            [-1.6, 1.6, -0.3],
            [-1.6, -1.6, -0.3],
          ]}
          color="#34d399"
          transparent
          opacity={0.3}
        />
      </Float>
    </group>
  );
}

export default function MarketScene() {
  return (
    <SceneCanvas
      camera={{ position: [0, 0, 9], fov: 42 }}
      fallback={<span />}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      <ambientLight intensity={1.2} />
      <directionalLight position={[3, 4, 5]} intensity={2} />
      <ResearchStructure />
    </SceneCanvas>
  );
}
