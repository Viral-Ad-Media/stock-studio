"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { applyThemePref, readThemePref, resolveTheme, type ThemePref } from "@/lib/theme";

const ORDER: ThemePref[] = ["dark", "light", "system"];
const LABEL: Record<ThemePref, string> = { dark: "Dark", light: "Light", system: "System" };
const ICON = { dark: Moon, light: Sun, system: Monitor };

// One button that cycles Dark → Light → System. The label names the current
// theme and the next one, so the control is clear to screen readers too.
export default function ThemeToggle({ withLabel = false, className = "" }: { withLabel?: boolean; className?: string }) {
  // Server render assumes the default; the real preference is read after mount.
  const [pref, setPref] = useState<ThemePref>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPref(readThemePref());
    setMounted(true);
  }, []);

  // Follow the OS while on "system".
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => document.documentElement.setAttribute("data-theme", resolveTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
  const Icon = ICON[pref];
  const label = `Theme: ${LABEL[pref]}. Switch to ${LABEL[next]}.`;

  return (
    <button
      type="button"
      onClick={() => {
        applyThemePref(next);
        setPref(next);
      }}
      aria-label={label}
      title={label}
      className={
        withLabel
          ? `flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-400 hover:bg-ink-800 hover:text-slate-200 ${className}`
          : `icon-btn ${className}`
      }
      // Avoid a server/client icon mismatch flash before the preference is read.
      suppressHydrationWarning
    >
      <Icon className="h-4 w-4" aria-hidden />
      {withLabel && <span suppressHydrationWarning>Theme: {mounted ? LABEL[pref] : LABEL.dark}</span>}
    </button>
  );
}
