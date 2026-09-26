import type { Config } from "tailwindcss";

// Every colour the UI uses is a CSS variable (app/globals.css), so light and
// dark mode swap palettes by flipping html[data-theme] — no per-component
// "dark:" classes. Values are space-separated RGB for Tailwind's opacity
// modifiers (bg-ink-950/80 etc.).
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: v("ink-950"),
          900: v("ink-900"),
          800: v("ink-800"),
          700: v("ink-700"),
          600: v("ink-600"),
          // >=3:1 against ink-800/900 in both themes — form-field borders (WCAG 1.4.11).
          500: v("ink-500"),
        },
        // Secondary text that passes WCAG AA (>=4.5:1) on every ink surface in both themes.
        fg: { subtle: v("fg-subtle") },
        slate: { 100: v("slate-100"), 200: v("slate-200"), 300: v("slate-300"), 400: v("slate-400") },
        emerald: { 300: v("emerald-300"), 400: v("emerald-400"), 500: v("emerald-500") },
        red: { 300: v("red-300"), 400: v("red-400"), 500: v("red-500") },
        amber: { 200: v("amber-200"), 300: v("amber-300"), 400: v("amber-400"), 500: v("amber-500") },
        sky: { 300: v("sky-300"), 400: v("sky-400"), 500: v("sky-500") },
      },
    },
  },
  plugins: [],
};

export default config;
