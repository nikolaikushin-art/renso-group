/**
 * iOS component kit.
 *
 * Roni's note was that the modules look generic. That's structural, not
 * cosmetic: each page had been built out of ad-hoc divs, so no two lists
 * separated their rows the same way, status was communicated with whatever
 * colour was to hand, and "related records" didn't exist as a concept at all.
 *
 * This file is the fix. Every module is rebuilt from the same small set of
 * primitives — inset grouped lists, tinted status pills, filled/tinted/plain
 * buttons, stat tiles, a chain timeline and a related-records panel — so the
 * app reads as one system rather than fourteen pages that happen to share a
 * sidebar.
 *
 * Deliberate colour decision: no orange anywhere. Apple uses a neutral tint
 * for a countdown and reserves red for something that has actually gone
 * wrong, so `expiryTone` returns neutral / caution / danger on that basis.
 */
import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Page scaffolding                                                           */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="ios-large-title text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] leading-snug text-ink-secondary">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Uppercase label above an inset group, as iOS Settings uses. */
export function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-1">
      <span className="ios-section-label">{children}</span>
      {trailing ? <span className="text-[12px] text-ink-tertiary">{trailing}</span> : null}
    </div>
  );
}

export function Group({
  children,
  className,
  label,
  labelTrailing,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  labelTrailing?: ReactNode;
}) {
  return (
    <section className={className}>
      {label ? <SectionLabel trailing={labelTrailing}>{label}</SectionLabel> : null}
      <div className="ios-group">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The workhorse. A leading icon tile, title, subtitle, trailing value and a
 * chevron when it navigates — the shape of essentially every row in iOS.
 */
export function Row({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  value,
  valueSub,
  trailing,
  onClick,
  chevron,
  className,
}: {
  icon?: LucideIcon;
  iconClass?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  valueSub?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}) {
  const showChevron = chevron ?? Boolean(onClick);
  const body = (
    <>
      {Icon ? (
        <span
          className={cn(
            "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[7px] text-white",
            iconClass || "bg-accent",
          )}
        >
          <Icon className="h-[17px] w-[17px]" strokeWidth={2.1} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-tight text-ink">
          {title}
        </span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-[13px] leading-tight text-ink-secondary">
            {subtitle}
          </span>
        ) : null}
      </span>
      {value !== undefined || valueSub !== undefined ? (
        <span className="shrink-0 text-right">
          {value !== undefined ? (
            <span className="tnum block text-[15px] font-semibold text-ink">{value}</span>
          ) : null}
          {valueSub !== undefined ? (
            <span className="block text-[12px] text-ink-tertiary">{valueSub}</span>
          ) : null}
        </span>
      ) : null}
      {trailing}
      {showChevron ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={2.4} />
      ) : null}
    </>
  );

  const classes = cn(
    "ios-row row-hover flex w-full items-center gap-3 px-3.5 py-3 text-left",
    className,
  );

  if (!onClick) return <div className={classes}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cn(classes, "brand-focus")}>
      {body}
    </button>
  );
}

/** Label-on-the-left, value-on-the-right detail row (iOS "info" list). */
export function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="ios-row flex items-start justify-between gap-4 px-3.5 py-2.5">
      <span className="shrink-0 text-[14px] text-ink-secondary">{label}</span>
      <span
        className={cn(
          "min-w-0 text-right text-[14px] font-medium text-ink",
          mono && "font-mono text-[13px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * iOS has exactly three button weights. Offering more is how a UI ends up
 * looking generic — every author invents a fourth.
 */
export function Button({
  children,
  onClick,
  variant = "tinted",
  size = "md",
  icon: Icon,
  disabled,
  tone = "accent",
  className,
  type = "button",
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "filled" | "tinted" | "plain";
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  disabled?: boolean;
  tone?: "accent" | "danger" | "success";
  className?: string;
  type?: "button" | "submit";
}) {
  const toneRgb =
    tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--accent)";
  const sizes = {
    sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
    md: "h-10 px-4 text-[14px] gap-2 rounded-[10px]",
    lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
  }[size];

  const style =
    variant === "filled"
      ? { backgroundColor: `rgb(${toneRgb})`, color: "#fff" }
      : variant === "tinted"
        ? { backgroundColor: `rgb(${toneRgb} / 0.16)`, color: `rgb(${toneRgb})` }
        : { color: `rgb(${toneRgb})` };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? undefined : style}
      className={cn(
        "brand-focus brand-pressable inline-flex items-center justify-center font-semibold transition-opacity",
        sizes,
        disabled && "cursor-not-allowed bg-elevated text-ink-tertiary opacity-60",
        className,
      )}
    >
      {Icon ? <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.3} /> : null}
      {children}
    </button>
  );
}

/** Circular icon button — the iOS nav-bar affordance. */
export function CircleButton({
  icon: Icon,
  label,
  onClick,
  tone = "accent",
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  tone?: "accent" | "danger" | "neutral";
}) {
  const toneRgb =
    tone === "danger" ? "var(--danger)" : tone === "neutral" ? "var(--text-secondary)" : "var(--accent)";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ backgroundColor: `rgb(${toneRgb} / 0.16)`, color: `rgb(${toneRgb})` }}
      className="brand-focus brand-pressable flex h-9 w-9 items-center justify-center rounded-full"
    >
      <Icon className="h-[17px] w-[17px]" strokeWidth={2.2} />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("ios-segment", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-active={value === o.id}
          onClick={() => onChange(o.id)}
          className="ios-segment-item brand-focus"
        >
          {o.label}
          {o.count !== undefined ? (
            <span className="ml-1.5 tnum opacity-60">{o.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export type PillTone = "neutral" | "accent" | "success" | "danger" | "caution";

export function Pill({
  children,
  tone = "neutral",
  icon: Icon,
}: {
  children: ReactNode;
  tone?: PillTone;
  icon?: LucideIcon;
}) {
  return (
    <span className={cn("ios-pill", `ios-pill-${tone}`)}>
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.4} /> : null}
      {children}
    </span>
  );
}

/**
 * Status vocabulary, in one place.
 *
 * Previously each page decided for itself what colour "confirmed" was, which
 * is exactly why the app felt like separate products. Anything unmapped falls
 * back to neutral rather than inventing a colour.
 */
const STATUS_TONES: Record<string, PillTone> = {
  // money / documents
  paid: "success",
  collected: "success",
  issued: "accent",
  partial: "caution",
  overdue: "danger",
  outstanding: "accent",
  draft: "neutral",
  sent: "accent",
  accepted: "success",
  rejected: "danger",
  expired: "danger",
  cancelled: "neutral",
  // orders
  confirmed: "accent",
  in_progress: "accent",
  shipped: "accent",
  delivered: "success",
  // accounts
  active: "success",
  preferred: "success",
  inactive: "neutral",
  blocked: "danger",
  dormant: "neutral",
  prospect: "accent",
  // kyc / review
  approved: "success",
  pending: "caution",
  pending_review: "caution",
  submitted: "accent",
  none: "neutral",
  matching: "accent",
  open: "accent",
  closed_won: "success",
  closed_lost: "neutral",
};

export function StatusPill({ status }: { status: string }) {
  const key = (status || "").toLowerCase().replace(/[\s-]/g, "_");
  return <Pill tone={STATUS_TONES[key] ?? "neutral"}>{status.replace(/_/g, " ")}</Pill>;
}

/**
 * Expiry tone. Neutral while there's plenty of time, a muted caution inside
 * the warning window, red only once it has actually expired — never orange.
 */
export function expiryTone(daysLeft: number | null | undefined): PillTone {
  if (daysLeft === null || daysLeft === undefined) return "neutral";
  if (daysLeft < 0) return "danger";
  if (daysLeft <= 45) return "caution";
  return "neutral";
}

/* -------------------------------------------------------------------------- */
/* Data display                                                               */
/* -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: PillTone;
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  const toneRgb =
    tone === "danger"
      ? "var(--danger)"
      : tone === "success"
        ? "var(--success)"
        : tone === "caution"
          ? "var(--caution)"
          : tone === "accent"
            ? "var(--accent)"
            : "var(--text-primary)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "ios-group flex min-w-0 flex-col gap-1 p-3.5 text-left",
        onClick && "brand-focus card-hover",
      )}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </span>
      <span
        className="tnum text-[22px] font-bold leading-none tracking-tight"
        style={{ color: `rgb(${toneRgb})` }}
      >
        {value}
      </span>
      {hint ? <span className="text-[11.5px] text-ink-tertiary">{hint}</span> : null}
    </Tag>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">{children}</div>;
}

export function ProgressBar({
  value,
  tone = "accent",
}: {
  /** 0–1. */
  value: number;
  tone?: "accent" | "success" | "danger";
}) {
  const pct = Math.max(0, Math.min(1, value || 0)) * 100;
  const toneRgb =
    tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--accent)";
  return (
    <div className="ios-fill h-1.5 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${pct}%`, backgroundColor: `rgb(${toneRgb})` }}
      />
    </div>
  );
}

/**
 * The enquiry → quotation → order → delivery → invoice → payment chain, drawn
 * as a timeline. It appears on every record that sits somewhere in that chain,
 * because Roni's second requirement is precisely that the stages be visible as
 * one flow rather than six unrelated modules.
 */
export function ChainTimeline({
  stages,
  onOpen,
}: {
  stages: {
    label: string;
    state: "done" | "current" | "todo";
    detail?: string;
    onOpen?: () => void;
  }[];
  onOpen?: () => void;
}) {
  return (
    <ol className="flex flex-col">
      {stages.map((stage, i) => {
        const last = i === stages.length - 1;
        const dotColour =
          stage.state === "done"
            ? "rgb(var(--success))"
            : stage.state === "current"
              ? "rgb(var(--accent))"
              : "rgb(var(--fill-primary) / 0.35)";
        return (
          <li key={stage.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className="mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-4"
                style={{
                  backgroundColor: dotColour,
                  // The ring fades the dot into the card rather than drawing a
                  // hard outline, which is how iOS renders progress dots.
                  ["--tw-ring-color" as string]: "rgb(var(--surface))",
                }}
              />
              {!last ? (
                <span
                  className="w-[2px] flex-1"
                  style={{
                    backgroundColor:
                      stage.state === "done"
                        ? "rgb(var(--success) / 0.45)"
                        : "rgb(var(--fill-primary) / 0.25)",
                    minHeight: "22px",
                  }}
                />
              ) : null}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
              <button
                type="button"
                onClick={stage.onOpen}
                disabled={!stage.onOpen}
                className={cn(
                  "block text-left",
                  stage.onOpen ? "brand-focus" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "block text-[14px] font-semibold leading-tight",
                    stage.state === "todo" ? "text-ink-tertiary" : "text-ink",
                  )}
                >
                  {stage.label}
                </span>
                {stage.detail ? (
                  <span
                    className={cn(
                      "mt-0.5 block text-[12.5px] leading-tight",
                      stage.onOpen ? "text-accent" : "text-ink-secondary",
                    )}
                  >
                    {stage.detail}
                  </span>
                ) : null}
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Related records panel.
 *
 * This is the single biggest answer to "it doesn't feel like one system":
 * every detail view ends with the other records that touch it, live-valued and
 * one tap away.
 */
export function RelatedPanel({
  items,
  label = "Related",
  empty = "Nothing linked to this record yet.",
}: {
  items: {
    key: string;
    icon: LucideIcon;
    label: string;
    title: string;
    detail?: string;
    onOpen: () => void;
  }[];
  label?: string;
  empty?: string;
}) {
  return (
    <Group label={label} labelTrailing={items.length ? `${items.length}` : undefined}>
      {items.length === 0 ? (
        <p className="px-3.5 py-4 text-[13.5px] text-ink-secondary">{empty}</p>
      ) : (
        items.map((item) => (
          <Row
            key={item.key}
            icon={item.icon}
            title={item.title}
            subtitle={item.detail}
            trailing={<Pill tone="neutral">{item.label}</Pill>}
            onClick={item.onOpen}
          />
        ))
      )}
    </Group>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ios-group flex min-h-[220px] flex-col items-center justify-center px-6 py-12 text-center">
      {Icon ? (
        <span className="ios-fill mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
          <Icon className="h-7 w-7 text-ink-tertiary" strokeWidth={1.5} />
        </span>
      ) : null}
      <div className="text-[16px] font-semibold text-ink">{title}</div>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="ios-fill-soft flex h-10 items-center gap-2 rounded-[10px] px-3">
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-tertiary" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary"
      />
    </div>
  );
}

/** Sheet — iOS presents secondary flows as a card that slides up, not a dialog. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  width = "max-w-[520px]",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 px-0 sm:items-center sm:px-4">
      <div
        className={cn(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-overlay sm:rounded-2xl",
          width,
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
          <span className="text-[16px] font-semibold text-ink">{title}</span>
          <Button variant="plain" size="sm" onClick={onClose}>
            Done
          </Button>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <footer className="border-t border-divider p-4">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

/** Back affordance matching the iOS nav bar. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-focus -ml-1 inline-flex items-center gap-0.5 text-[15px] font-medium text-accent"
    >
      <ChevronRight className="h-4 w-4 rotate-180" strokeWidth={2.6} />
      {label}
    </button>
  );
}
