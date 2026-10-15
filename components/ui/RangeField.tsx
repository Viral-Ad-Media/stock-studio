"use client";

import { useId } from "react";

export default function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="field-label">
        {label}:{" "}
        <output htmlFor={id}>
          {value}
          {suffix}
        </output>
      </span>
      <input
        id={id}
        aria-label={label}
        className="w-full accent-sky-400"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
