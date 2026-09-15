/**
 * Renso Group CRM — Apple-flavoured display primitives.
 *
 * `ios.tsx` covers the *structural* language: grouped lists, rows, pills,
 * sheets. This file covers the things Apple uses to make a number feel
 * physical — activity rings, sparklines, a Dynamic-Island-style status
 * capsule, digits that count up rather than snap.
 *
 * Constraints held deliberately:
 *
 * - **Hand-drawn SVG, no chart library.** recharts is already lazy-loaded for
 *   the one dashboard chart; adding a second charting dependency for a 40px
 *   sparkline would cost more bundle than the entire feature.
 * - **Tokens only.** Every colour comes from a CSS variable, so all of this
 *   follows the theme switch with no light/dark special-casing.
 * - **Reduced motion is respected in JavaScript, not just CSS.** An animated
 *   counter driven by rAF cannot be stopped by a media query, so the hook
 *   checks the preference and renders the final value immediately.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Motion preference                                                          */
/* -------------------------------------------------------------------------- */

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* -------------------------------------------------------------------------- */
/* Counting digits                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Eases a number up to its value on mount and on change. Apple animates the
 * *digits*, not the container, which is why a changing total reads as the same
 * number moving rather than a new number appearing.
 */
export function NumberTicker({
  value,
  format,
  duration = 650,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const fromRef = useRef(reduced ? value : 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const from = fromRef.current;
    const start = performance.now();
    const step = (t: number) => {
      const progress = Math.min(1, (t - start) / duration);
      // Cubic ease-out: fast arrival, soft landing — the iOS curve.
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (value - from) * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, duration, reduced]);

  const text = format ? format(display) : Math.round(display).toLocaleString("en-GB");
  return <span className={cn("tnum", className)}>{text}</span>;
}

/* -------------------------------------------------------------------------- */
/* Activity rings                                                             */
/* -------------------------------------------------------------------------- */

export interface RingSpec {
  label: string;
  /** 0–1. Values above 1 are drawn as a full ring and reported as over target. */
  value: number;
  /** Token name without the var() wrapper, e.g. "--success". */
  token: string;
  /** Shown in the legend. */
  caption?: string;
}

/**
 * Concentric progress rings, as Apple Fitness draws them. Three arcs read as
 * one glance-able state in a way three progress bars never do, which is the
 * whole point on a dashboard people look at for two seconds.
 */
export function ActivityRings({
  rings,
  size = 132,
  thickness = 11,
  centre,
}: {
  rings: RingSpec[];
  size?: number;
  thickness?: number;
  centre?: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const gap = 4;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        style={{ transform: "rotate(-90deg)" }}
      >
        {rings.map((ring, index) => {
          const radius = size / 2 - thickness / 2 - index * (thickness + gap);
          if (radius <= thickness) return null;
          const circumference = 2 * Math.PI * radius;
          const clamped = Math.max(0, Math.min(1, ring.value || 0));
          return (
            <g key={ring.label}>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={`rgb(var(${ring.token}) / 0.16)`}
                strokeWidth={thickness}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={`rgb(var(${ring.token}))`}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - clamped)}
                style={
                  reduced
                    ? undefined
                    : {
                        transition: "stroke-dashoffset 900ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                      }
                }
              />
            </g>
          );
        })}
      </svg>
      {centre ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centre}
        </div>
      ) : null}
    </div>
  );
}

/** Single ring with a value in the middle — used for one metric against a cap. */
export function RingGauge({
  value,
  token = "--accent",
  size = 76,
  thickness = 8,
  label,
  sublabel,
}: {
  value: number;
  token?: string;
  size?: number;
  thickness?: number;
  label: string;
  sublabel?: string;
}) {
  return (
    <ActivityRings
      rings={[{ label, value, token }]}
      size={size}
      thickness={thickness}
      centre={
        <>
          <span
            className="tnum text-[15px] font-bold leading-none"
            style={{ color: `rgb(var(${token}))` }}
          >
            {label}
          </span>
          {sublabel ? (
            <span className="mt-0.5 text-[9.5px] uppercase tracking-wide text-ink-tertiary">
              {sublabel}
            </span>
          ) : null}
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A price or revenue curve at row scale. Draws the line, a soft fill beneath
 * it and a dot on the latest point, because the latest point is the one the
 * reader is looking for. A single observation renders as a dot alone rather
 * than a flat line, so the chart never implies a trend it doesn't have.
 */
export function Sparkline({
  values,
  width = 96,
  height = 30,
  token = "--accent",
  showLast = true,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  token?: string;
  showLast?: boolean;
  className?: string;
}) {
  const geometry = useMemo(() => {
    if (!values.length) return null;
    const pad = 3;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
    const points = values.map((value, index) => ({
      x: pad + index * stepX,
      y: height - pad - ((value - min) / span) * (height - pad * 2),
    }));
    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(" ");
    const area = `${line} L${points[points.length - 1].x.toFixed(2)} ${height - pad} L${points[0].x.toFixed(
      2,
    )} ${height - pad} Z`;
    return { points, line, area, last: points[points.length - 1] };
  }, [values, width, height]);

  if (!geometry) return null;
  const single = values.length === 1;
  const gradientId = `spark-${token.replace(/[^a-z]/gi, "")}-${values.length}-${Math.round(
    values[0] * 100,
  )}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`rgb(var(${token}) / 0.28)`} />
          <stop offset="100%" stopColor={`rgb(var(${token}) / 0)`} />
        </linearGradient>
      </defs>
      {!single ? (
        <>
          <path d={geometry.area} fill={`url(#${gradientId})`} />
          <path
            d={geometry.line}
            fill="none"
            stroke={`rgb(var(${token}))`}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {showLast || single ? (
        <circle
          cx={geometry.last.x}
          cy={single ? height / 2 : geometry.last.y}
          r={2.6}
          fill={`rgb(var(${token}))`}
        />
      ) : null}
    </svg>
  );
}

/**
 * Actual against target on one line — Apple's Health-style bullet. Clearer
 * than two bars because the target stays in the same place while the bar moves.
 */
export function BulletBar({
  value,
  target,
  token = "--accent",
  height = 8,
}: {
  value: number;
  target: number;
  token?: string;
  height?: number;
}) {
  const ceiling = Math.max(value, target) * 1.15 || 1;
  const valuePct = Math.max(0, Math.min(100, (value / ceiling) * 100));
  const targetPct = Math.max(0, Math.min(100, (target / ceiling) * 100));
  return (
    <div
      className="relative w-full overflow-hidden rounded-full"
      style={{ height, backgroundColor: `rgb(var(${token}) / 0.14)` }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${valuePct}%`, backgroundColor: `rgb(var(${token}))` }}
      />
      <div
        className="absolute top-0 h-full w-[2px] rounded-full"
        style={{ left: `${targetPct}%`, backgroundColor: "rgb(var(--text-primary) / 0.55)" }}
        title="Target"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live capsule                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Dynamic Island idea, applied to a CRM: a compact pill that carries the
 * one live fact worth interrupting for, expanding on hover or focus to show
 * the detail and an action. It sits in the top bar and is the only element in
 * the app permitted to animate on its own.
 */
export function LiveCapsule({
  icon: Icon,
  label,
  detail,
  tone = "--accent",
  pulse = false,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  tone?: string;
  pulse?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group brand-focus flex h-9 max-w-[52px] items-center gap-2 overflow-hidden rounded-full px-2.5",
        "transition-[max-width,background-color] duration-300 ease-out hover:max-w-[420px] focus-visible:max-w-[420px]",
        className,
      )}
      style={{ backgroundColor: `rgb(var(${tone}) / 0.14)` }}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        {pulse ? (
          <span
            className="absolute inset-0 rounded-full renso-pulse"
            style={{ backgroundColor: `rgb(var(${tone}) / 0.35)` }}
          />
        ) : null}
        <Icon
          className="relative h-[15px] w-[15px]"
          strokeWidth={2.3}
          style={{ color: `rgb(var(${tone}))` }}
        />
      </span>
      <span
        className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[12.5px] font-semibold opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: `rgb(var(${tone}))` }}
      >
        {label}
        {detail ? (
          <span className="font-normal text-ink-secondary">{detail}</span>
        ) : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Wallet stack                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Apple Wallet's stacked cards: collapsed they show only their top edge, and
 * the selected one lifts clear. Used for the severity queues, where the point
 * is that there *are* several and only one is being worked.
 */
export function WalletStack({
  cards,
  activeIndex,
  onSelect,
}: {
  cards: { key: string; tone: string; title: string; subtitle?: string; body?: ReactNode }[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="relative">
      {cards.map((card, index) => {
        const active = index === activeIndex;
        const offset = index * 12;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onSelect(index)}
            className={cn(
              "brand-focus block w-full rounded-2xl border p-3.5 text-left transition-all duration-300 ease-out",
              active ? "relative z-10 shadow-overlay" : "hover:-translate-y-0.5",
            )}
            style={{
              backgroundColor: `rgb(var(${card.tone}) / ${active ? 0.14 : 0.08})`,
              borderColor: `rgb(var(${card.tone}) / ${active ? 0.5 : 0.2})`,
              marginTop: index === 0 ? 0 : active ? 8 : -offset / 2,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className="text-[13.5px] font-semibold"
                style={{ color: `rgb(var(${card.tone}))` }}
              >
                {card.title}
              </span>
              {card.subtitle ? (
                <span className="tnum text-[12px] text-ink-secondary">{card.subtitle}</span>
              ) : null}
            </div>
            {active && card.body ? <div className="mt-2.5">{card.body}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small parts                                                                */
/* -------------------------------------------------------------------------- */

export function SeverityDot({ token, pulse }: { token: string; pulse?: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {pulse ? (
        <span
          className="absolute inset-0 rounded-full renso-pulse"
          style={{ backgroundColor: `rgb(var(${token}) / 0.5)` }}
        />
      ) : null}
      <span
        className="relative h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: `rgb(var(${token}))` }}
      />
    </span>
  );
}

/** Keyboard hint, rendered the way macOS menus do. */
export function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded-[5px] border border-divider bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Labelled slider for what-if inputs. Native range input, styled through the
 * accent token, because a custom drag implementation would lose keyboard and
 * VoiceOver support for no visual gain.
 */
export function ScrubSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-secondary">{label}</span>
        <span className="tnum text-[14px] font-semibold text-ink">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="renso-range mt-2 w-full"
      />
    </label>
  );
}

/** Row of tiny bars — a distribution where a sparkline would imply continuity. */
export function MiniBars({
  values,
  token = "--accent",
  height = 26,
  barWidth = 5,
}: {
  values: number[];
  token?: string;
  height?: number;
  barWidth?: number;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {values.map((value, index) => (
        <span
          key={index}
          className="rounded-[2px] transition-[height] duration-500"
          style={{
            width: barWidth,
            height: Math.max(2, (value / max) * height),
            backgroundColor: `rgb(var(${token}) / ${value > 0 ? 0.85 : 0.2})`,
          }}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity heatmap                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Calendar heatmap, as Apple Health draws a habit and GitHub draws commits.
 *
 * Columns are weeks, rows are weekdays. The point of the shape is the *gaps*:
 * a bar chart of weekly totals hides the fact that nobody contacted anyone
 * between the 4th and the 11th, and that is the thing worth seeing.
 */
export function ActivityHeatmap({
  days,
  token = "--accent",
  cell = 12,
  gap = 3,
  emptyLabel = "no activity",
}: {
  days: { date: string; total: number; sent?: number; received?: number }[];
  token?: string;
  cell?: number;
  gap?: number;
  emptyLabel?: string;
}) {
  if (!days.length) return null;
  const max = Math.max(...days.map((d) => d.total), 1);

  // Pad the front so the first column starts on a Monday; without this the
  // weekday rows are meaningless.
  const firstDay = new Date(days[0].date);
  const offset = (firstDay.getDay() + 6) % 7;
  const cells: (typeof days[number] | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...days,
  ];

  const weeks: (typeof days[number] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="flex gap-[3px]" style={{ gap }}>
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col" style={{ gap }}>
          {Array.from({ length: 7 }, (_, di) => {
            const day = week[di] ?? null;
            if (!day) {
              return <span key={di} style={{ width: cell, height: cell }} />;
            }
            // Four steps rather than a continuous ramp: the eye reads bands,
            // and a continuous ramp makes one busy day flatten everything else.
            const ratio = day.total / max;
            const opacity =
              day.total === 0 ? 0.07 : ratio > 0.66 ? 1 : ratio > 0.33 ? 0.62 : 0.32;
            const label = new Date(day.date).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            });
            return (
              <span
                key={di}
                title={
                  day.total === 0
                    ? `${label} — ${emptyLabel}`
                    : `${label} — ${day.total} message${day.total === 1 ? "" : "s"}${
                        day.sent !== undefined
                          ? ` (${day.sent} sent, ${day.received ?? 0} received)`
                          : ""
                      }`
                }
                className="rounded-[3px]"
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: `rgb(var(${token}) / ${opacity})`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Waterfall                                                                  */
/* -------------------------------------------------------------------------- */

export interface WaterfallStep {
  label: string;
  /** Signed: negative steps are deductions. */
  value: number;
  /** Draw as a running total rather than a step. */
  total?: boolean;
}

/**
 * Revenue down to net profit, as a waterfall.
 *
 * A stack of four numbers tells you the answer; a waterfall tells you where it
 * went, which is the question anyone looking at a profit figure actually has.
 */
export function Waterfall({
  steps,
  format,
  height = 168,
}: {
  steps: WaterfallStep[];
  format: (n: number) => string;
  height?: number;
}) {
  let running = 0;
  const bars = steps.map((step) => {
    const start = step.total ? 0 : running;
    if (!step.total) running += step.value;
    const end = step.total ? step.value : running;
    return { ...step, start, end };
  });
  const peak = Math.max(...bars.map((b) => Math.max(Math.abs(b.start), Math.abs(b.end))), 1);

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {bars.map((bar) => {
        const top = Math.max(bar.start, bar.end);
        const bottom = Math.min(bar.start, bar.end);
        const barHeight = Math.max(3, ((top - bottom) / peak) * (height - 34));
        const offset = (bottom / peak) * (height - 34);
        const token = bar.total
          ? bar.value >= 0
            ? "--accent"
            : "--danger"
          : bar.value >= 0
            ? "--success"
            : "--danger";
        return (
          <div key={bar.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="relative w-full flex-1">
              <span
                className="absolute w-full rounded-[4px] transition-[height] duration-500"
                style={{
                  height: barHeight,
                  bottom: offset,
                  backgroundColor: `rgb(var(${token}) / ${bar.total ? 1 : 0.55})`,
                }}
              />
            </div>
            <span className="tnum w-full truncate text-center text-[11px] font-semibold text-ink">
              {format(bar.total ? bar.value : bar.value)}
            </span>
            <span className="w-full truncate text-center text-[10.5px] leading-tight text-ink-tertiary">
              {bar.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Share bar                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One horizontal bar split by share, with a legend. Chosen over a pie because
 * a pie with six slices is unreadable and a pie with two is a sentence.
 */
export function ShareBar({
  segments,
  format,
}: {
  segments: { label: string; value: number; share: number }[];
  format: (n: number) => string;
}) {
  const tokens = ["--accent", "--success", "--caution", "--info", "--text-tertiary"];
  return (
    <div className="space-y-2.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[rgb(var(--fill-primary)/0.15)]">
        {segments.map((segment, index) => (
          <span
            key={segment.label}
            className="h-full transition-[width] duration-500"
            style={{
              width: `${Math.max(0, segment.share * 100)}%`,
              backgroundColor: `rgb(var(${tokens[index % tokens.length]}))`,
            }}
            title={`${segment.label} — ${Math.round(segment.share * 100)}%`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment, index) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[12px]">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: `rgb(var(${tokens[index % tokens.length]}))` }}
            />
            <span className="text-ink-secondary">{segment.label}</span>
            <span className="tnum font-semibold text-ink">{format(segment.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Signed change chip. Neutral below the threshold, because ±1% is noise. */
export function TrendPill({
  changePct,
  threshold = 2,
}: {
  changePct: number | null;
  threshold?: number;
}) {
  if (changePct === null) {
    return <span className="text-[11.5px] text-ink-tertiary">no prior period</span>;
  }
  const flat = Math.abs(changePct) < threshold;
  const token = flat ? "--text-tertiary" : changePct > 0 ? "--success" : "--danger";
  return (
    <span
      className="tnum rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        backgroundColor: `rgb(var(${token}) / 0.14)`,
        color: `rgb(var(${token}))`,
      }}
    >
      {flat ? "flat" : `${changePct > 0 ? "+" : ""}${Math.round(changePct)}%`}
    </span>
  );
}
