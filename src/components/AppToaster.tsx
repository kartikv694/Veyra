"use client";

/**
 * Mounts the app's toast notification viewport (sonner), themed to match
 * whatever light/dark mode is currently active via `ThemeProvider`. Render
 * this once near the root (see layout.tsx) — individual pages then just
 * `import { toast } from "sonner"` and call `toast.success(...)` /
 * `toast.error(...)` without needing to know this exists.
 */
import { Toaster } from "sonner";
import { useTheme } from "./ThemeProvider";

export function AppToaster() {
  const { theme } = useTheme();

  return (
    <Toaster
      theme={theme}
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
        },
      }}
    />
  );
}
