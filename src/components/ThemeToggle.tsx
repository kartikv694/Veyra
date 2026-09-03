"use client";

/**
 * The visible light/dark switch — a pill-shaped toggle with a sliding
 * sun/moon icon. Reads and flips theme state from `ThemeProvider`; has no
 * props because there's only ever one theme for the whole app.
 */
import { Sun, Moon } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Switch color theme"
      className="relative flex h-9 w-16 items-center rounded-full border border-edge bg-surface2 px-1 transition-colors"
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full bg-surface shadow-sm transition-transform duration-200 ${
          theme === "dark" ? "translate-x-7" : "translate-x-0"
        }`}
      >
        {theme === "dark" ? (
          <Moon size={14} className="text-accent" />
        ) : (
          <Sun size={14} className="text-accent" />
        )}
      </span>
    </button>
  );
}
