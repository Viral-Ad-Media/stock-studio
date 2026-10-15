"use client";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import SceneCanvas from "@/components/motion/SceneCanvas";
import { Float, RoundedBox, Line } from "@react-three/drei";
import { MathUtils, type Group } from "three";
import type { GuideStage } from "./GuideVisual";
function Cards({ stage }: { stage: GuideStage }) {
  const root = useRef<Group>(null);
  useFrame((_, delta) => {
    if (root.current)
      root.current.rotation.y = MathUtils.damp(
        root.current.rotation.y,
        stage === "workspace" ? -0.35 : 0.05,
        3,
        delta,
      );
  });
  const selected =
    stage === "workspace"
      ? -1
      : ["research", "thesis", "journal"].indexOf(stage);
  return (
    <group ref={root} rotation={[0.12, -0.35, 0]}>
      <Line
        points={[
          [-2, 0, -0.15],
          [2, 0, -0.15],
        ]}
        color="#34d399"
        transparent
        opacity={0.35}
      />
      {[0, 1, 2].map((n) => (
        <Float
          key={n}
          speed={1.2}
          floatIntensity={selected === n ? 0.25 : 0.08}
          rotationIntensity={0.06}
        >
          <group
            position={[(n - 1) * 1.6, 0, selected === n ? 0.5 : n * -0.15]}
          >
            <RoundedBox args={[1.25, 1.25, 0.1]} radius={0.09} smoothness={3}>
              <meshStandardMaterial
                color={selected === n ? "#065f46" : "#172b3b"}
                metalness={0.15}
                roughness={0.5}
              />
            </RoundedBox>
            {[0.3, 0, -0.3].map((y, i) => (
              <mesh key={y} position={[-0.03, y, 0.07]}>
                <boxGeometry args={[i === 2 ? 0.55 : 0.85, 0.065, 0.025]} />
                <meshBasicMaterial color={i === 0 ? "#34d399" : "#64748b"} />
              </mesh>
            ))}
          </group>
        </Float>
      ))}
    </group>
  );
}
export default function GuideScene({ stage }: { stage: GuideStage }) {
  return (
    <SceneCanvas camera={{ position: [0, 0, 7], fov: 35 }}>
      <color attach="background" args={["#0b1929"]} />
      <ambientLight intensity={1.7} />
      <directionalLight position={[2, 3, 5]} intensity={2} />
      <Cards stage={stage} />
    </SceneCanvas>
  );
}
