"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Toggles the `.dark` class on <html>. The initial class is applied by the
 * inline script in the root layout, so this component never needs to know the
 * theme to render: it always draws both icons and hides one with CSS, which
 * keeps server and client markup identical (no hydration mismatch).
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the session still toggles, it just won't persist.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      onClick={toggle}
      aria-label="Chuyển giữa giao diện sáng và tối"
      title="Chuyển giữa giao diện sáng và tối"
    >
      <Sun aria-hidden="true" className="hidden dark:block" />
      <Moon aria-hidden="true" className="dark:hidden" />
    </Button>
  );
}
