/**
 * Theme — one source of truth for light/dark, mounted above the auth gate.
 *
 * Previously `useTheme` was a plain hook living in Shell, which meant every
 * component that called it got its *own* piece of state. The sidebar toggle and
 * the Settings → Appearance toggle were therefore two independent switches that
 * both wrote the same DOM attribute and disagreed with each other about which
 * icon to show. It also ran nowhere on the sign-in screen, so a saved light
 * preference was ignored until after you signed in — the app booted dark, then
 * flipped.
 *
 * Both problems are the same problem: theme is application state, not component
 * state. It lives in a provider now, the attribute is written once on boot
 * before React paints, and every toggle in the app drives the same value.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeName = "light" | "dark";

const THEME_KEY = "renso.web.theme";

/** Reads the stored preference, falling back to the OS setting, then dark. */
export function resolveInitialTheme(): ThemeName {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode — fall through */
  }
  try {
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    /* no matchMedia — fall through */
  }
  return "dark";
}

interface ThemeContextValue {
  theme: ThemeName;
  isDark: boolean;
  toggle: () => void;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(resolveInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    // `color-scheme` makes the browser's own chrome — scrollbars, form
    // controls, the address bar on mobile — follow the app instead of sitting
    // in the opposite theme.
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f2f2f5" : "#0a0a0c");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeName) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "light" ? "dark" : "light")),
    [],
  );

  const value = useMemo(
    () => ({ theme, isDark: theme === "dark", toggle, setTheme }),
    [theme, toggle, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Usable anywhere under the provider. Falls back to a self-contained local
 * theme if something renders outside it, so a stray component can never crash
 * the app over a colour scheme.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const [fallback, setFallback] = useState<ThemeName>(resolveInitialTheme);
  const fallbackValue = useMemo<ThemeContextValue>(
    () => ({
      theme: fallback,
      isDark: fallback === "dark",
      toggle: () => setFallback((t) => (t === "light" ? "dark" : "light")),
      setTheme: setFallback,
    }),
    [fallback],
  );
  return ctx ?? fallbackValue;
}
