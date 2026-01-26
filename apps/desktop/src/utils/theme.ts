import type { ThemeMode, AccentColor } from "../types/schema";
import { ACCENT_COLORS } from "../types/schema";

export const applyTheme = (theme: ThemeMode): void => {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");

  if (theme === "light") {
    root.classList.add("theme-light");
  } else if (theme === "dark") {
    root.classList.add("theme-dark");
  }
  // "system" = no class, uses media query
};

export const applyAccentColor = (accentColor: AccentColor): void => {
  const color = ACCENT_COLORS[accentColor];
  document.documentElement.style.setProperty("--color-accent", color);
};
