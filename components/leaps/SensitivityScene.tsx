"use client";
import { useMemo } from "react";
import SceneCanvas from "@/components/motion/SceneCanvas";
import { Line, OrbitControls } from "@react-three/drei";
import { daysBetweenDates, optionModel, type LeapsInput } from "@/lib/leaps";
type Props = { input: LeapsInput; move: number; elapsed: number; iv: number };
function Surface({ input, move, elapsed, iv }: Props) {
  const days = daysBetweenDates(input.as_of, input.expiration);
  const data = useMemo(() => {
    const price = (move: number, elapsed: number) =>
      optionModel(
        input.type,
        input.spot * (1 + move / 100),
        input.strike,
        days - elapsed,
        iv,
        input.rate,
        input.dividend,
      ).price;
    const grid = Array.from({ length: 13 }, (_, t) =>
      Array.from({ length: 13 }, (_, p) =>
        price(-50 + (p * 100) / 12, (t * days) / 12),
      ),
    );
    const peak = Math.max(1, ...grid.flat());
    const point = (
      p: number,
      t: number,
      value: number,
    ): [number, number, number] => [
      -2 + (p / 12) * 4,
      (value / peak) * 2,
      2 - (t / 12) * 4,
    ];
    return {
      rows: grid.map((row, t) => row.map((v, p) => point(p, t, v))),
      columns: grid[0].map((_, p) => grid.map((row, t) => point(p, t, row[p]))),
      marker: [
        (move / 50) * 2,
        (price(move, elapsed) / peak) * 2,
        2 - (days ? elapsed / days : 0) * 4,
      ] as [number, number, number],
      peak,
    };
  }, [input, move, elapsed, iv, days]);
  return (
    <>
      {data.rows.map((points, n) => (
        <Line
          key={`r${n}`}
          points={points}
          color="#2dd4bf"
          lineWidth={1}
          transparent
          opacity={0.65}
        />
      ))}
      {data.columns.map((points, n) => (
        <Line
          key={`c${n}`}
          points={points}
          color="#60a5fa"
          lineWidth={1}
          transparent
          opacity={0.5}
        />
      ))}
      <Line
        points={[
          [-2, 0, 2],
          [2, 0, 2],
        ]}
        color="#94a3b8"
      />
      <Line
        points={[
          [-2, 0, 2],
          [-2, 0, -2],
        ]}
        color="#94a3b8"
      />
      <Line
        points={[
          [-2, 0, 2],
          [-2, 2, 2],
        ]}
        color="#94a3b8"
      />
      <mesh position={data.marker}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>
    </>
  );
}
export default function SensitivityScene(props: Props) {
  return (
    <SceneCanvas frameloop="demand" camera={{ position: [6, 4.5, 6], fov: 42 }}>
      <color attach="background" args={["#081522"]} />
      <Surface {...props} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping={false}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 2.1}
      />
    </SceneCanvas>
  );
}
