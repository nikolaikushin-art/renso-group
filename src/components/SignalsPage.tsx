/**
 * Renso Group CRM — Signals.
 *
 * The answer to "I have fourteen modules and forty minutes". Everything that
 * needs a person today, read across every module, ranked by consequence, each
 * row carrying the evidence and opening the record it came from.
 *
 * Two things make this a control surface rather than a notification list:
 *
 * - **Nothing here is stored.** Signals are derived on every render from the
 *   live records, so clearing an invoice makes its signal disappear without a
 *   sync step, and a dismissal only suppresses the row for the session. If the
 *   invoice is still overdue tomorrow, the signal is back — which is correct.
 * - **Every row states its evidence and its action.** A row that can't say
 *   what it's looking at and what to do about it doesn't earn the space.
 */
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Gauge,
  Percent,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  briefText,
  summariseSignals,
  KIND_LABELS,
  type Severity,
  type Signal,
  type SignalKind,
  type SignalTarget,
} from "@/lib/signals";
import { useLiveSignals } from "@/lib/useSignals";
import { PageHeader, Button, Group, Segmented, EmptyState, Pill } from "@/components/ios";
import { ActivityRings, NumberTicker, SeverityDot } from "@/components/apple";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY_TOKEN: Record<Severity, string> = {
  critical: "--danger",
  high: "--accent",
  medium: "--caution",
  low: "--text-tertiary",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const KIND_ICON: Record<SignalKind, LucideIcon> = {
  receivable: Banknote,
  credit: Gauge,
  margin: Percent,
  price: TrendingUp,
  compliance: ShieldCheck,
  fulfilment: Boxes,
  pipeline: Clock,
  relationship: Users,
  data: BadgeCheck,
};

export function SignalsPage({
  onOpenRecord,
}: {
  onOpenRecord: (target: SignalTarget, id?: string) => void;
}) {
  const store = useStore();
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [copied, setCopied] = useState(false);

  const signals = useLiveSignals();

  // `useLiveSignals` has already removed dismissed rows; the count of what was
  // removed comes from the store so the "Restore" affordance can appear.
  const visible = signals;
  const summary = summariseSignals(visible, store.fx.base);
  const shown = filter === "all" ? visible : visible.filter((s) => s.severity === filter);
  const dismissedCount = store.dismissedSignals.length;

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(briefText(visible));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard unavailable — the button simply does nothing rather than
         throwing an error at someone who only wanted to paste a list. */
    }
  };

  // Rings read as one glance: how much is critical, how much is money, how
  // much of the book is clean. Denominators are deliberately conservative so a
  // quiet day shows near-empty rings instead of a full ring of nothing.
  const rings = [
    {
      label: "Critical",
      value: summary.critical / 5,
      token: "--danger",
    },
    {
      label: "High",
      value: summary.high / 8,
      token: "--accent",
    },
    {
      label: "Medium & low",
      value: (summary.medium + summary.low) / 14,
      token: "--caution",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signals"
        subtitle={`Everything across the platform that needs a person today, read live from ${store.customers.length} accounts, ${store.invoices.length} invoices and ${store.pricingRecords.length} supplier offers.`}
        actions={
          <>
            {dismissedCount > 0 ? (
              <Button variant="plain" icon={RotateCcw} onClick={store.restoreSignals}>
                Restore {dismissedCount}
              </Button>
            ) : null}
            <Button
              variant="tinted"
              icon={copied ? CheckCircle2 : ClipboardCopy}
              onClick={copyBrief}
            >
              {copied ? "Copied" : "Copy morning brief"}
            </Button>
          </>
        }
      />

      {/* Hero */}
      <div className="ios-group flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <ActivityRings
          rings={rings}
          centre={
            <>
              <NumberTicker
                value={summary.total}
                className="text-[30px] font-bold leading-none tracking-tight text-ink"
              />
              <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                open
              </span>
            </>
          }
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {(["critical", "high", "medium", "low"] as Severity[]).map((severity) => (
              <button
                key={severity}
                type="button"
                onClick={() => setFilter(filter === severity ? "all" : severity)}
                className="brand-focus flex items-center gap-2 text-left"
              >
                <SeverityDot
                  token={SEVERITY_TOKEN[severity]}
                  pulse={severity === "critical" && summary.critical > 0}
                />
                <span>
                  <span className="tnum block text-[19px] font-bold leading-none text-ink">
                    {summary[severity]}
                  </span>
                  <span className="text-[11.5px] text-ink-tertiary">
                    {SEVERITY_LABEL[severity]}
                  </span>
                </span>
              </button>
            ))}
            <span className="border-l border-divider pl-6">
              <span className="tnum block text-[19px] font-bold leading-none text-ink">
                {money(summary.valueAtStake, summary.currency)}
              </span>
              <span className="text-[11.5px] text-ink-tertiary">
                Cash at stake, {summary.currency}
              </span>
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-ink-secondary">
            {summary.total === 0
              ? "Nothing needs attention. No overdue invoices, no expiring paperwork, no quotations past their follow-up date."
              : summary.critical > 0
                ? "Work the critical rows first — each one is either money at risk or a commitment made against an account that cannot carry it."
                : "No criticals. The list below is ordered by consequence, not by date."}
          </p>
        </div>
      </div>

      {/* Kind breakdown */}
      {summary.byKind.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {summary.byKind.map((entry) => {
            const Icon = KIND_ICON[entry.kind];
            return (
              <span
                key={entry.kind}
                className="ios-fill-soft flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] text-ink-secondary"
              >
                <Icon className="h-3.5 w-3.5" />
                {KIND_LABELS[entry.kind]}
                <span className="tnum font-semibold text-ink">{entry.count}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      <Segmented<"all" | Severity>
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: "All", count: visible.length },
          { id: "critical", label: "Critical", count: summary.critical },
          { id: "high", label: "High", count: summary.high },
          { id: "medium", label: "Medium", count: summary.medium },
          { id: "low", label: "Low", count: summary.low },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={visible.length === 0 ? "Clear" : `Nothing at ${filter} severity`}
          description={
            visible.length === 0
              ? "Every invoice is inside terms, every document is in date, and no quotation is past its follow-up. This page will populate itself the moment that stops being true."
              : "Switch back to All to see the rest of the queue."
          }
        />
      ) : (
        <div className="space-y-2.5">
          {shown.map((signal, index) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              index={index}
              onOpen={() => onOpenRecord(signal.target, signal.recordId)}
              onDismiss={() => store.dismissSignal(signal.id)}
            />
          ))}
        </div>
      )}

      <Group label="How this list is built">
        <div className="space-y-2 px-3.5 py-3 text-[13px] leading-relaxed text-ink-secondary">
          <p>
            Signals are derived on every render from the live records — nothing is
            stored, so there is no queue to go stale and no sync to run.
            Dismissing a row hides it for this session only.
          </p>
          <p>
            Financial figures are converted into {store.fx.base} using the rate
            table in Settings. Where a rate is missing the amount is reported in
            its own currency rather than assumed to be parity, and where a rate is
            over a month old a data-quality signal says so.
          </p>
        </div>
      </Group>
    </div>
  );
}

function SignalCard({
  signal,
  index,
  onOpen,
  onDismiss,
}: {
  signal: Signal;
  index: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const token = SEVERITY_TOKEN[signal.severity];
  const Icon = KIND_ICON[signal.kind];
  return (
    <article
      className="signal-card renso-stagger"
      style={{ ["--signal-tone" as string]: `var(${token})`, ["--i" as string]: index }}
    >
      <div className="flex items-start gap-3 py-3 pl-4 pr-3">
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: `rgb(var(${token}) / 0.16)` }}
        >
          <Icon
            className="h-[17px] w-[17px]"
            strokeWidth={2.2}
            style={{ color: `rgb(var(${token}))` }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-semibold leading-snug text-ink">
              {signal.title}
            </h3>
            <Pill
              tone={
                signal.severity === "critical"
                  ? "danger"
                  : signal.severity === "high"
                    ? "accent"
                    : signal.severity === "medium"
                      ? "caution"
                      : "neutral"
              }
            >
              {KIND_LABELS[signal.kind]}
            </Pill>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            {signal.detail}
          </p>
          {signal.action ? (
            <p
              className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium"
              style={{ color: `rgb(var(${token}))` }}
            >
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.3} />
              {signal.action}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "brand-focus flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold",
            )}
            style={{ backgroundColor: `rgb(var(${token}) / 0.14)`, color: `rgb(var(${token}))` }}
          >
            Open
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss for this session"
            title="Dismiss for this session"
            className="brand-focus flex h-8 w-8 items-center justify-center rounded-lg text-ink-tertiary hover:bg-elevated"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}
