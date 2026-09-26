// Theme preference: "dark" (default), "light", or "system" (follow the OS).
// Stored per browser; applied to html[data-theme] before first paint by
// THEME_INIT_SCRIPT (app/layout.tsx) so there's no flash of the wrong theme.
export type ThemePref = "dark" | "light" | "system";
export const THEME_KEY = "ss_theme";

export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p!=="light"&&p!=="system")p="dark";var t=p==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

export function readThemePref(): ThemePref {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === "light" || p === "system" ? p : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    // storage blocked: still apply for this page view
  }
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}
