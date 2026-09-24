import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0e14",
          900: "#0f1420",
          800: "#161d2e",
          700: "#1f2940",
          600: "#2b3a5c",
          // >=3:1 against ink-800/900 — use for form-field borders (WCAG 1.4.11).
          500: "#5b6d96",
        },
        // Secondary text that passes WCAG AA (>=4.5:1) on every ink surface.
        // Use instead of slate-500/600, which fail on the dark background.
        fg: {
          subtle: "#8391a7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
