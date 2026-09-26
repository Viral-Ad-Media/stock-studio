"use client";

import { cloneElement, isValidElement, useId, useState } from "react";

// A small note that points at a control. Shown on hover and on keyboard
// focus, dismissed with Escape, and linked to the control with
// aria-describedby so screen readers announce it too. The control keeps its
// own aria-label; the tooltip adds a hint, it never replaces the name.
export default function Tooltip({
  text,
  side = "top",
  align = "center",
  children,
}: {
  text: string;
  side?: "top" | "bottom";
  // "end" pins the note to the control's right edge, for controls at the
  // right of a row, so it never runs off the screen.
  align?: "center" | "end";
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!isValidElement(children)) return children;

  const child = cloneElement(children, {
    "aria-describedby": id,
    onFocus: (e: React.FocusEvent) => {
      setOpen(true);
      (children.props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
    },
    onBlur: (e: React.FocusEvent) => {
      setOpen(false);
      (children.props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
    },
  });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      {child}
      <span
        id={id}
        role="tooltip"
        // Closed notes are display:none so they never widen the page;
        // aria-describedby still reads hidden text.
        className={`pointer-events-none absolute z-50 w-max max-w-[16rem] rounded-md border border-ink-500 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg ${
          align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"
        } ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"} ${open ? "block" : "hidden"}`}
      >
        {text}
      </span>
    </span>
  );
}
