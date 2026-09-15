import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/** Brand token helper: keeps Tailwind's `/opacity` modifiers working. */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    extend: {
      colors: {
        canvas: token("--canvas"),
        surface: token("--surface"),
        elevated: token("--surface-elevated"),
        ink: {
          DEFAULT: token("--text-primary"),
          secondary: token("--text-secondary"),
          tertiary: token("--text-tertiary"),
        },
        accent: token("--accent"),
        divider: token("--divider"),
        success: token("--success"),
        warning: token("--warning"),
        info: token("--info"),

        // shadcn primitives, bound to the same tokens.
        border: token("--divider"),
        input: token("--divider"),
        ring: token("--accent"),
        background: token("--canvas"),
        foreground: token("--text-primary"),
        primary: {
          DEFAULT: token("--accent"),
          foreground: "rgb(255 255 255 / <alpha-value>)",
        },
        secondary: {
          DEFAULT: token("--surface-elevated"),
          foreground: token("--text-primary"),
        },
        destructive: {
          DEFAULT: token("--accent"),
          foreground: "rgb(255 255 255 / <alpha-value>)",
        },
        muted: {
          DEFAULT: token("--surface-elevated"),
          foreground: token("--text-secondary"),
        },
        popover: {
          DEFAULT: token("--surface"),
          foreground: token("--text-primary"),
        },
        card: {
          DEFAULT: token("--surface"),
          foreground: token("--text-primary"),
        },
      },
      borderRadius: {
        card: "16px",
        control: "12px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        rise: "rise 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
        fade: "fade 0.16s ease-out",
        "slide-in-right": "slide-in-right 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      boxShadow: {
        // One overlay shadow for the whole app, tuned for a near-black canvas
        // where a default Tailwind shadow is invisible.
        overlay: "0 24px 60px -12px rgb(0 0 0 / 0.55)",
        panel: "0 8px 28px -12px rgb(0 0 0 / 0.45)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
