/**
 * Renso Group CRM — Price Intelligence.
 *
 * Every approved offer the desk has banked is a dated observation of what a
 * product cost from a named supplier. This module reads them as a curve, which
 * is the difference between a pricing database and pricing *intelligence*:
 *
 * - whether a product is drifting up or down, and by how much over 90 days;
 * - whether the supplier quoting most recently is still the cheapest one;
 * - how jumpy a product is, so a desk knows which prices it can hold for
 *   fourteen days and which it cannot;
 * - what the cheapest live offer would save against the standing purchase
 *   price the products module has been quoting from.
 *
 * All comparison happens in one currency. Observations that cannot be converted
 * are excluded and counted on screen, never folded in at parity.
 */
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Minus,
  PiggyBank,
  TrendingUp,
  Waves,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  priceCurves,
  priceMoves,
  supplierSpread,
  type PriceCurve,
  type TrendDirection,
} from "@/lib/priceIndex";
import {
  PageHeader,
  Group,
  Row,
  Segmented,
  StatTile,
  StatRow,
  Pill,
  EmptyState,
  FieldRow,
  Button,
} from "@/components/ios";
import { Sparkline } from "@/components/apple";
import { money, moneyExact, shortDate } from "@/lib/format";
import type { AppSection } from "@/components/Shell";

const WINDOWS = [30, 90, 365] as const;
type Window = (typeof WINDOWS)[number];

const DIRECTION_TOKEN: Record<TrendDirection, string> = {
  rising: "--danger",
  falling: "--success",
  flat: "--text-secondary",
  unknown: "--text-tertiary",
};

const DIRECTION_ICON = {
  rising: ArrowUpRight,
  falling: ArrowDownRight,
  flat: Minus,
  unknown: Minus,
};

export function PriceIntelPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [window, setWindow] = useState<Window>(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const curves = useMemo(
    () =>
      priceCurves(store.products, store.pricingRecords, store.fx, {
        currency: store.fx.base,
        windowDays: window,
      }),
    [store.products, store.pricingRecords, store.fx, window],
  );

  const withData = curves.filter((c) => c.observations.length > 0);
  const moves = useMemo(
    () => priceMoves(curves, store.tradeSettings.priceAlertThresholdPct),
    [curves, store.tradeSettings.priceAlertThresholdPct],
  );
  const selected = withData.find((c) => c.productId === selectedId) ?? withData[0] ?? null;

  const switchable = withData.filter((c) => c.betterSupplierAvailable);
  const totalSaving = switchable.reduce((sum, curve) => {
    if (!curve.best || !curve.latest) return sum;
    return sum + (curve.latest.unitPrice - curve.best.unitPrice);
  }, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price Intelligence"
        subtitle={`Supplier price curves built from ${store.pricingRecords.filter((r) => r.status === "approved").length} approved offers, compared in ${store.fx.base}.`}
        actions={
          <Button variant="plain" onClick={() => onOpenRecord("pricing")}>
            Pricing queue
          </Button>
        }
      />

      <StatRow>
        <StatTile
          label="Products with a curve"
          value={`${withData.length} / ${curves.length}`}
          hint="Two or more observations are needed for a trend"
          icon={Boxes}
        />
        <StatTile
          label="Material moves"
          value={String(moves.length)}
          hint={`Over ${store.tradeSettings.priceAlertThresholdPct}% in ${window} days`}
          tone={moves.length ? "caution" : "success"}
          icon={TrendingUp}
        />
        <StatTile
          label="Cheaper supplier available"
          value={String(switchable.length)}
          hint={
            switchable.length
              ? `${moneyExact(totalSaving, store.fx.base)} per unit across those lines`
              : "Incumbent is cheapest everywhere"
          }
          tone={switchable.length ? "accent" : "success"}
          icon={PiggyBank}
        />
        <StatTile
          label="Most volatile"
          value={
            withData.filter((c) => c.volatilityPct !== null).length
              ? `${Math.max(
                  ...withData.map((c) => c.volatilityPct ?? 0),
                ).toFixed(1)}%`
              : "—"
          }
          hint="Spread around the mean — hold prices carefully above 10%"
          icon={Waves}
        />
      </StatRow>

      <Segmented
        value={String(window) as string}
        onChange={(next) => setWindow(Number(next) as Window)}
        options={WINDOWS.map((w) => ({ id: String(w), label: `${w} days` }))}
      />

      {moves.length ? (
        <Group label="Movement alerts" labelTrailing={`${moves.length}`}>
          {moves.map((move) => {
            const Icon = DIRECTION_ICON[move.direction];
            const token = DIRECTION_TOKEN[move.direction];
            return (
              <div key={move.productId} className="ios-row px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                    style={{ backgroundColor: `rgb(var(${token}) / 0.16)` }}
                  >
                    <Icon
                      className="h-4 w-4"
                      strokeWidth={2.4}
                      style={{ color: `rgb(var(${token}))` }}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold text-ink">
                      {move.productName} {move.direction === "rising" ? "up" : "down"}{" "}
                      {Math.abs(move.changePct)}%
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-ink-secondary">
                      {moneyExact(move.from, move.currency)} →{" "}
                      {moneyExact(move.to, move.currency)} per unit over {move.windowDays} days.
                      {move.alternative
                        ? ` ${move.alternative.supplierName} is ${move.alternative.savingPct}% cheaper right now.`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(move.productId)}
                    className="brand-focus shrink-0 text-[12.5px] font-semibold text-accent"
                  >
                    Curve
                  </button>
                </div>
              </div>
            );
          })}
        </Group>
      ) : null}

      {withData.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No price history yet"
          description="A curve needs approved offers against a product. Approve offers in the pricing queue — each one becomes a dated observation here, and two are enough to state a direction."
          action={
            <Button variant="tinted" onClick={() => onOpenRecord("pricing")}>
              Open the pricing queue
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <Group label="Products" labelTrailing="Most observed first">
            {withData.map((curve) => {
              const token = DIRECTION_TOKEN[curve.direction];
              return (
                <Row
                  key={curve.productId}
                  title={curve.productName}
                  subtitle={`${curve.observations.length} observation${
                    curve.observations.length === 1 ? "" : "s"
                  } · ${curve.sku ?? "no SKU"}`}
                  onClick={() => setSelectedId(curve.productId)}
                  className={
                    selected?.productId === curve.productId ? "bg-accent/[0.07]" : undefined
                  }
                  trailing={
                    <span className="flex items-center gap-2.5">
                      <Sparkline
                        values={curve.observations.map((o) => o.unitPrice)}
                        token={token}
                        width={64}
                        height={24}
                      />
                      <span
                        className="tnum w-[52px] text-right text-[13px] font-semibold"
                        style={{ color: `rgb(var(${token}))` }}
                      >
                        {curve.changePct === null
                          ? "—"
                          : `${curve.changePct > 0 ? "+" : ""}${curve.changePct}%`}
                      </span>
                    </span>
                  }
                />
              );
            })}
          </Group>

          {selected ? (
            <CurveDetail key={selected.productId} curve={selected} onOpenRecord={onOpenRecord} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function CurveDetail({
  curve,
  onOpenRecord,
}: {
  curve: PriceCurve;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const token = DIRECTION_TOKEN[curve.direction];
  const spread = supplierSpread(curve);
  const prices = curve.observations.map((o) => o.unitPrice);

  return (
    <div className="space-y-4">
      <div className="ios-group p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-ink">{curve.productName}</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-tertiary">
              {curve.sku} · compared in {curve.currency} · {curve.windowDays}-day window
            </p>
          </div>
          <Pill
            tone={
              curve.direction === "rising"
                ? "danger"
                : curve.direction === "falling"
                  ? "success"
                  : "neutral"
            }
          >
            {curve.direction === "unknown"
              ? "one observation"
              : curve.direction === "flat"
                ? "no material move"
                : `${curve.changePct! > 0 ? "+" : ""}${curve.changePct}% over ${curve.windowDays}d`}
          </Pill>
        </div>

        <div className="renso-grid-lines mt-4 rounded-xl px-1 py-2">
          <Sparkline values={prices} token={token} width={640} height={112} className="w-full" />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-tertiary">
          <span>{shortDate(curve.observations[0].at)}</span>
          <span>{shortDate(curve.observations[curve.observations.length - 1].at)}</span>
        </div>

        {curve.excluded > 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">
            {curve.excluded} observation{curve.excluded === 1 ? "" : "s"} excluded — quoted in a
            currency with no rate set, so including them would mean assuming parity.
          </p>
        ) : null}
      </div>

      <Group label="Position">
        <FieldRow
          label="Latest offer"
          value={
            curve.latest
              ? `${moneyExact(curve.latest.unitPrice, curve.currency)} · ${curve.latest.supplierName}`
              : "—"
          }
        />
        <FieldRow
          label="Cheapest live offer"
          value={
            curve.best
              ? `${moneyExact(curve.best.unitPrice, curve.currency)} · ${curve.best.supplierName}`
              : "—"
          }
        />
        <FieldRow
          label="Mean over the window"
          value={curve.mean === null ? "—" : moneyExact(curve.mean, curve.currency)}
        />
        <FieldRow
          label="Volatility"
          value={
            curve.volatilityPct === null ? (
              "Not enough observations"
            ) : (
              <span
                style={{
                  color:
                    curve.volatilityPct > 10
                      ? "rgb(var(--caution))"
                      : "rgb(var(--text-primary))",
                }}
              >
                {curve.volatilityPct}%{curve.volatilityPct > 10 ? " — hold prices carefully" : ""}
              </span>
            )
          }
        />
        <FieldRow
          label="Saving against the standing purchase price"
          value={
            curve.savingVsStandingPct === null ? (
              "No purchase price set"
            ) : (
              <span
                style={{
                  color:
                    curve.savingVsStandingPct > 0
                      ? "rgb(var(--success))"
                      : "rgb(var(--danger))",
                }}
              >
                {curve.savingVsStandingPct > 0 ? "" : "+"}
                {Math.abs(curve.savingVsStandingPct)}%{" "}
                {curve.savingVsStandingPct > 0 ? "cheaper" : "more expensive"}
              </span>
            )
          }
        />
      </Group>

      {curve.betterSupplierAvailable && curve.best && curve.latest ? (
        <div
          className="ios-group p-4"
          style={{ borderColor: "rgb(var(--accent) / 0.4)" }}
        >
          <div className="flex items-start gap-3">
            <PiggyBank
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: "rgb(var(--accent))" }}
            />
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold text-ink">
                A cheaper supplier is live on this product
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                {curve.best.supplierName} is at{" "}
                {moneyExact(curve.best.unitPrice, curve.currency)} against{" "}
                {curve.latest.supplierName} at{" "}
                {moneyExact(curve.latest.unitPrice, curve.currency)} — a saving of{" "}
                {moneyExact(curve.latest.unitPrice - curve.best.unitPrice, curve.currency)} per
                unit, or {money((curve.latest.unitPrice - curve.best.unitPrice) * 1000, curve.currency)}{" "}
                on a thousand units. Delivery terms and lead time may differ; check the offer
                before switching.
              </p>
              <button
                type="button"
                onClick={() => onOpenRecord("pricing", curve.best!.offerId)}
                className="brand-focus mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"
              >
                Open the offer
                <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Group label="Supplier league table" labelTrailing="Latest price each">
        {spread.map((entry) => (
          <Row
            key={entry.supplierName}
            title={entry.supplierName}
            subtitle={`Quoted ${shortDate(entry.at)}`}
            value={moneyExact(entry.unitPrice, curve.currency)}
            valueSub={entry.vsBestPct === 0 ? "cheapest" : `+${entry.vsBestPct}%`}
            chevron={false}
          />
        ))}
      </Group>

      <Group label="Observations" labelTrailing={`${curve.observations.length}`}>
        {[...curve.observations].reverse().map((observation) => (
          <Row
            key={observation.offerId}
            title={observation.supplierName}
            subtitle={`${shortDate(observation.at)}${
              observation.quantity
                ? ` · ${observation.quantity.toLocaleString("en-GB")} units`
                : ""
            }${
              observation.nativeCurrency !== curve.currency
                ? ` · quoted ${observation.nativeCurrency} ${observation.nativePrice}`
                : ""
            }`}
            value={moneyExact(observation.unitPrice, curve.currency)}
            onClick={() => onOpenRecord("pricing", observation.offerId)}
            trailing={observation.stale ? <Pill tone="caution">stale rate</Pill> : undefined}
          />
        ))}
      </Group>
    </div>
  );
}
