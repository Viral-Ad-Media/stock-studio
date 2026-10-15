"use client";

export default function MotionToggle({
  paused,
  onToggle,
  label = "preview",
  className = "",
}: {
  paused: boolean;
  onToggle: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={paused}
      onClick={onToggle}
      className={`underline underline-offset-2 ${className}`}
    >
      {paused ? "Play" : "Pause"} {label}
    </button>
  );
}
