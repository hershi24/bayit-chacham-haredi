"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "ksh-theme";
const CHANGE_EVENT = "ksh-theme-change";

function readDark() {
  return document.documentElement.dataset.theme === "dark";
}

export function applyTheme(theme: "light" | "dark") {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeToggle({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync = () => setDark(readDark());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      className={`h-11 rounded-xl px-3 ${className}`}
      aria-pressed={dark}
      onClick={() => applyTheme(dark ? "light" : "dark")}
    >
      {dark ? (compact ? "בהיר" : "למצב בהיר") : compact ? "כהה" : "למצב כהה"}
    </Button>
  );
}
