"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);
const subscribers = new Set<() => void>();

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }

  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function resolveTheme(theme: Theme) {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(theme: Theme) {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.style.colorScheme = resolvedTheme;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

function getThemeSnapshot() {
  const theme = getStoredTheme();
  return `${theme}:${resolveTheme(theme)}`;
}

function getServerThemeSnapshot() {
  return "system:light";
}

function subscribeToTheme(callback: () => void) {
  subscribers.add(callback);

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
      callback();
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  media.addEventListener("change", handleChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    subscribers.delete(callback);
    media.removeEventListener("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function notifyThemeChange() {
  for (const callback of subscribers) {
    callback();
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const [theme, resolvedTheme] = snapshot.split(":") as [Theme, "light" | "dark"];

  useEffect(() => {
    applyTheme(getStoredTheme());
    notifyThemeChange();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    function setTheme(nextTheme: Theme) {
      applyTheme(nextTheme);
      notifyThemeChange();
    }

    return { theme, resolvedTheme, setTheme };
  }, [theme, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    return {
      theme: "system" as const,
      resolvedTheme: "light" as const,
      setTheme: () => undefined,
    };
  }

  return context;
}
