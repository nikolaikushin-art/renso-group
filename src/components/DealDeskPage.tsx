/**
 * Renso Group CRM — Deal Desk.
 *
 * The previous build's status note closed with an admission: "gross and net
 * margin remain estimates until purchase cost is linked at line level." This
 * module is that link, made into a working surface.
 *
 * Three things happen here that could not happen before:
 *
 * 1. **Every line on every quotation shows its own margin, and names where the
 *    cost came from** — an approved supplier offer, a standing purchase price,
 *    or nothing. A 31% margin measured against a live offer from Shenzhen is a
 *    different claim from a 31% margin inferred from a price someone typed in
 *    March, and the desk sees which it has.
 * 2. **Landed cost is modelled, not assumed.** Supplier price, FX, freight
 *    spread over the consignment, duty on goods value, insurance. Quoting off
 *    the supplier's unit price is the single most common way a 22% deal ships
 *    at 9%.
 * 3. **The price solver runs both ways** — target margin to selling price, and
 *    selling price back to the margin and markup it implies.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  FileWarning,
  Info,
  Percent,
  Ship,
  Target,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  COST_BASIS_LABELS,
  documentMargin,
  marginRanking,
  type DocumentMargin,
  type LineMargin,
  type MarginContext,
} from "@/lib/margin";
import { breakEven, landedCost, marginFromPrice, markupFromPrice, priceForMargin } from "@/lib/landed";
import { rateLabel, convert } from "@/lib/fx";
import {
  PageHeader,
  Button,
  Group,
  Row,
  Segmented,
  StatTile,
  StatRow,
  Pill,
  EmptyState,
  FieldRow,
  ProgressBar,
} from "@/components/ios";
import { BulletBar, ScrubSlider } from "@/components/apple";
import { moneyExact, money, shortDate } from "@/lib/format";
import type { AppSection } from "@/components/Shell";

type Scope = "live" | "orders" | "all";

export function DealDeskPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [scope, setScope] = useState<Scope>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ctx: MarginContext = useMemo(
    () => ({
      pricingRecords: store.pricingRecords,
      products: store.products,
      fx: store.fx,
      floorPct: store.productSettings.lowMarginThresholdPct,
    }),
    [store.pricingRecords, store.products, store.fx, store.productSettings.lowMarginThresholdPct],
  );

  const docs = useMemo(() => {
    if (scope === "orders") return store.orders.filter((o) => o.status !== "cancelled");
    const live = store.quotations.filter((q) =>
      ["draft", "sent", "viewed", "accepted"].includes(q.status),
    );
    if (scope === "live") return live;
    return [...live, ...store.orders.filter((o) => o.status !== "cancelled")];
  }, [scope, store.quotations, store.orders]);

  const ranked = useMemo(() => marginRanking(docs, ctx), [docs, ctx]);
  const selected = ranked.find((r) => r.doc.id === selectedId) ?? ranked[0] ?? null;

  const floor = store.productSettings.lowMarginThresholdPct;
  const breaches = ranked.filter((r) => (r.margin.marginPct ?? 100) < floor);
  const uncosted = ranked.filter((r) => r.margin.confidence !== "measured");

  const bookRevenue = ranked.reduce((sum, r) => sum + r.margin.revenue, 0);
  const bookMargin = ranked.reduce((sum, r) => sum + r.margin.margin, 0);
  const blendedPct = bookRevenue > 0 ? (bookMargin / bookRevenue) * 100 : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deal Desk"
        subtitle="Margin measured line by line against approved supplier offers, with the cost basis stated on every figure."
      />

      <StatRow>
        <StatTile
          label="Documents in scope"
          value={String(ranked.length)}
          hint={scope === "live" ? "Live quotations" : scope === "orders" ? "Open orders" : "Quotations and orders"}
          icon={Target}
        />
        <StatTile
          label="Blended margin"
          value={blendedPct === null ? "—" : `${blendedPct.toFixed(1)}%`}
          hint={blendedPct === null ? "No costed lines" : `Across ${money(bookRevenue, store.fx.base)}`}
          tone={blendedPct === null ? "neutral" : blendedPct < floor ? "danger" : "success"}
          icon={Percent}
        />
        <StatTile
          label={`Below the ${floor}% floor`}
          value={String(breaches.length)}
          hint={breaches.length ? "Need re-pricing or a recorded reason" : "Nothing under the floor"}
          tone={breaches.length ? "danger" : "success"}
          icon={AlertTriangle}
        />
        <StatTile
          label="Partly costed"
          value={String(uncosted.length)}
          hint="Margin stated over costed lines only"
          tone={uncosted.length ? "caution" : "neutral"}
          icon={FileWarning}
        />
      </StatRow>

      <Segmented
        value={scope}
        onChange={(next) => {
          setScope(next);
          setSelectedId(null);
        }}
        options={[
          { id: "live", label: "Live quotations" },
          { id: "orders", label: "Orders" },
          { id: "all", label: "Everything" },
        ]}
      />

      {ranked.length === 0 ? (
        <EmptyState
          icon={Percent}
          title="No margin to measure yet"
          description="Margin needs a cost behind it. Approve a supplier offer against a product, or set a purchase price, and every line quoting that product will start reporting its own margin."
          action={
            <Button variant="tinted" onClick={() => onOpenRecord("pricing")}>
              Open the pricing queue
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* Worst-first list. A desk should meet its problems before its wins. */}
          <Group label="Ranked by margin" labelTrailing="Worst first">
            {ranked.map((entry) => {
              const pct = entry.margin.marginPct;
              const active = selected?.doc.id === entry.doc.id;
              return (
                <Row
                  key={entry.doc.id}
                  title={entry.doc.number}
                  subtitle={
                    store.customers.find(
                      (c) => c.id === (entry.doc as { customerId?: string }).customerId,
                    )?.name ?? "—"
                  }
                  value={pct === null ? "—" : `${pct.toFixed(1)}%`}
                  valueSub={money(entry.margin.revenue, entry.margin.currency)}
                  onClick={() => setSelectedId(entry.doc.id)}
                  className={active ? "bg-accent/[0.07]" : undefined}
                  trailing={
                    pct !== null && pct < floor ? (
                      <Pill tone={pct < 0 ? "danger" : "caution"}>
                        {pct < 0 ? "below cost" : "under floor"}
                      </Pill>
                    ) : entry.margin.confidence !== "measured" ? (
                      <Pill tone="neutral">partial</Pill>
                    ) : undefined
                  }
                />
              );
            })}
          </Group>

          {selected ? (
            <MarginDetail
              key={selected.doc.id}
              number={selected.doc.number}
              margin={selected.margin}
              floor={floor}
              onOpenOffer={(id) => onOpenRecord("pricing", id)}
            />
          ) : null}
        </div>
      )}

      <LandedCostPanel />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Margin detail                                                              */
/* -------------------------------------------------------------------------- */

function MarginDetail({
  number,
  margin,
  floor,
  onOpenOffer,
}: {
  number: string;
  margin: DocumentMargin;
  floor: number;
  onOpenOffer: (offerId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="ios-group p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
              {number}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className="tnum text-[30px] font-bold leading-none tracking-tight"
                style={{
                  color:
                    margin.marginPct === null
                      ? "rgb(var(--text-tertiary))"
                      : margin.marginPct < floor
                        ? "rgb(var(--danger))"
                        : "rgb(var(--success))",
                }}
              >
                {margin.marginPct === null ? "Unknown" : `${margin.marginPct.toFixed(1)}%`}
              </span>
              <span className="text-[13px] text-ink-secondary">
                {moneyExact(margin.margin, margin.currency)} on{" "}
                {moneyExact(margin.revenue, margin.currency)}
              </span>
            </div>
          </div>
          <Pill
            tone={
              margin.confidence === "measured"
                ? "success"
                : margin.confidence === "partial"
                  ? "caution"
                  : "neutral"
            }
            icon={margin.confidence === "measured" ? CheckCircle2 : Info}
          >
            {margin.confidence === "measured"
              ? "Fully costed"
              : margin.confidence === "partial"
                ? "Partly costed"
                : "No cost linked"}
          </Pill>
        </div>

        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between text-[12px] text-ink-secondary">
            <span>Margin against the {floor}% floor</span>
            <span className="tnum">
              {margin.marginPct === null ? "—" : `${margin.marginPct.toFixed(1)}% / ${floor}%`}
            </span>
          </div>
          <BulletBar
            value={Math.max(0, margin.marginPct ?? 0)}
            target={floor}
            token={
              margin.marginPct !== null && margin.marginPct < floor ? "--danger" : "--success"
            }
          />
        </div>

        {margin.coverage < 1 ? (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-[12px] text-ink-secondary">
              <span>Revenue with a cost behind it</span>
              <span className="tnum">{Math.round(margin.coverage * 100)}%</span>
            </div>
            <ProgressBar value={margin.coverage} tone="accent" />
            <p className="text-[12px] leading-relaxed text-ink-tertiary">
              The percentage above is taken over costed revenue only.{" "}
              {margin.uncostedLines} line{margin.uncostedLines === 1 ? "" : "s"} have no cost, so
              they are excluded rather than counted at full margin.
            </p>
          </div>
        ) : null}
      </div>

      <Group label="Lines" labelTrailing={`${margin.lines.length}`}>
        {margin.lines.map((line) => (
          <LineRow key={line.lineId} line={line} floor={floor} onOpenOffer={onOpenOffer} />
        ))}
      </Group>
    </div>
  );
}

function LineRow({
  line,
  floor,
  onOpenOffer,
}: {
  line: LineMargin;
  floor: number;
  onOpenOffer: (offerId: string) => void;
}) {
  const tone =
    line.marginPct === null
      ? "rgb(var(--text-tertiary))"
      : line.marginPct < 0
        ? "rgb(var(--danger))"
        : line.marginPct < floor
          ? "rgb(var(--caution))"
          : "rgb(var(--success))";

  return (
    <div className="ios-row px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-medium text-ink">{line.description}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-secondary">
            {line.quantity.toLocaleString("en-GB")} ×{" "}
            {line.unitCost === null
              ? "cost unknown"
              : `${moneyExact(line.unitCost, "GBP").replace("£", "")} cost`}{" "}
            · {COST_BASIS_LABELS[line.basis]}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[15px] font-semibold" style={{ color: tone }}>
            {line.marginPct === null ? "—" : `${line.marginPct.toFixed(1)}%`}
          </div>
          <div className="tnum text-[12px] text-ink-tertiary">
            {line.margin === null ? "no cost" : moneyExact(line.margin, "GBP")}
          </div>
        </div>
      </div>

      {line.sourceSupplier ? (
        <button
          type="button"
          onClick={() => line.sourceOfferId && onOpenOffer(line.sourceOfferId)}
          className="brand-focus mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent"
        >
          Costed from {line.sourceSupplier}
          <ArrowRight className="h-3 w-3" strokeWidth={2.4} />
        </button>
      ) : null}

      {line.basis === "none" ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-tertiary">
          No approved offer and no standing purchase price for this line, so its margin is
          reported as unknown rather than as full margin.
        </p>
      ) : null}

      {line.note ? (
        <p className="mt-2 flex gap-1.5 text-[12.5px] leading-relaxed text-ink-tertiary">
          <Info className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          {line.note}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Landed cost                                                                */
/* -------------------------------------------------------------------------- */

function LandedCostPanel() {
  const store = useStore();
  const settings = store.tradeSettings;
  const offers = store.pricingRecords.filter((r) => r.status === "approved");

  const [offerId, setOfferId] = useState(offers[0]?.id ?? "");
  const [quantity, setQuantity] = useState(offers[0]?.quantity ?? 1000);
  const [freight, setFreight] = useState(settings.defaultFreightTotal);
  const [duty, setDuty] = useState(settings.defaultDutyPct);
  const [insurance, setInsurance] = useState(settings.defaultInsurancePct);
  const [other, setOther] = useState(0);
  const [targetMargin, setTargetMargin] = useState(settings.targetMarginPct);
  const [fixedCost, setFixedCost] = useState(0);

  const offer = offers.find((o) => o.id === offerId) ?? offers[0] ?? null;

  const result = useMemo(() => {
    if (!offer) return null;
    return landedCost(
      {
        unitPrice: offer.unitPrice,
        currency: offer.currency,
        quantity,
        freightTotal: freight,
        freightCurrency: settings.freightCurrency,
        dutyPct: duty,
        insurancePct: insurance,
        otherPerUnit: other,
        targetCurrency: store.fx.base,
      },
      store.fx,
    );
  }, [offer, quantity, freight, duty, insurance, other, settings.freightCurrency, store.fx]);

  const suggested = result ? priceForMargin(result.landedPerUnit, targetMargin) : null;
  const [sellingPrice, setSellingPrice] = useState<number | null>(null);
  const effectivePrice = sellingPrice ?? suggested ?? 0;
  const impliedMargin = result ? marginFromPrice(result.landedPerUnit, effectivePrice) : null;
  const impliedMarkup = result ? markupFromPrice(result.landedPerUnit, effectivePrice) : null;
  const be = result ? breakEven(result.landedPerUnit, effectivePrice, fixedCost) : null;

  const rateNote = useMemo(() => {
    if (!offer || offer.currency === store.fx.base) return null;
    const converted = convert(1, offer.currency, store.fx.base, store.fx);
    return converted ? rateLabel(converted, offer.currency, store.fx.base) : null;
  }, [offer, store.fx]);

  if (!offer || !result) {
    return (
      <EmptyState
        icon={Ship}
        title="Landed cost needs an approved offer"
        description="Approve a supplier offer in the pricing queue and it becomes available here for freight, duty and FX modelling."
      />
    );
  }

  const currency = store.fx.base;

  return (
    <div className="space-y-4">
      <Group
        label="Landed cost calculator"
        labelTrailing={`Quoting in ${currency}`}
      >
        <div className="px-3.5 py-3">
          <label className="block text-[12px] font-medium text-ink-secondary">
            Supplier offer
            <select
              value={offer.id}
              onChange={(e) => {
                const next = offers.find((o) => o.id === e.target.value);
                setOfferId(e.target.value);
                if (next?.quantity) setQuantity(next.quantity);
                setSellingPrice(null);
              }}
              className="mt-1.5 h-10 w-full rounded-[10px] border border-divider bg-canvas px-3 text-[14px] text-ink"
            >
              {offers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.productName} — {o.supplierName} · {o.currency} {o.unitPrice} ·{" "}
                  {shortDate(o.extractedAt)}
                </option>
              ))}
            </select>
          </label>
          {rateNote ? (
            <p className="mt-2 text-[12px] text-ink-tertiary">{rateNote}</p>
          ) : null}
        </div>

        <div className="grid gap-4 px-3.5 py-3 sm:grid-cols-2">
          <ScrubSlider
            label="Consignment quantity"
            value={quantity}
            min={100}
            max={20000}
            step={100}
            onChange={setQuantity}
          />
          <ScrubSlider
            label={`Freight, total (${settings.freightCurrency})`}
            value={freight}
            min={0}
            max={12000}
            step={50}
            onChange={setFreight}
          />
          <ScrubSlider
            label="Import duty"
            value={duty}
            min={0}
            max={25}
            step={0.1}
            suffix="%"
            onChange={setDuty}
          />
          <ScrubSlider
            label="Insurance"
            value={insurance}
            min={0}
            max={3}
            step={0.05}
            suffix="%"
            onChange={setInsurance}
          />
          <ScrubSlider
            label={`Other, per unit (${currency})`}
            value={other}
            min={0}
            max={10}
            step={0.05}
            onChange={setOther}
          />
          <ScrubSlider
            label="Deal fixed cost (tooling, certification)"
            value={fixedCost}
            min={0}
            max={20000}
            step={100}
            onChange={setFixedCost}
          />
        </div>

        <FieldRow
          label="Goods, per unit"
          value={`${moneyExact(result.goodsPerUnit, currency)}`}
        />
        <FieldRow label="Freight, per unit" value={moneyExact(result.freightPerUnit, currency)} />
        <FieldRow
          label={`Duty at ${duty}% of goods value`}
          value={moneyExact(result.dutyPerUnit, currency)}
        />
        <FieldRow
          label={`Insurance at ${insurance}%`}
          value={moneyExact(result.insurancePerUnit, currency)}
        />
        {other > 0 ? (
          <FieldRow label="Other, per unit" value={moneyExact(result.otherPerUnit, currency)} />
        ) : null}
        <div className="ios-row flex items-center justify-between px-3.5 py-3">
          <span className="text-[14px] font-semibold text-ink">Landed cost, per unit</span>
          <span className="text-right">
            <span className="tnum block text-[19px] font-bold text-ink">
              {moneyExact(result.landedPerUnit, currency)}
            </span>
            <span className="text-[12px] text-ink-tertiary">
              {result.upliftPct > 0 ? `+${result.upliftPct}% over the offer price` : "no uplift"}
            </span>
          </span>
        </div>
        <FieldRow
          label={`Consignment, ${quantity.toLocaleString("en-GB")} units`}
          value={money(result.landedTotal, currency)}
        />

        {result.warnings.length ? (
          <div className="ios-row px-3.5 py-3">
            {result.warnings.map((warning) => (
              <p
                key={warning}
                className="flex gap-1.5 text-[12.5px] leading-relaxed text-ink-secondary"
              >
                <AlertTriangle
                  className="mt-[2px] h-3.5 w-3.5 shrink-0"
                  style={{ color: "rgb(var(--caution))" }}
                />
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </Group>

      <Group label="Price solver" labelTrailing="Margin on revenue, not markup">
        <div className="px-3.5 py-3">
          <ScrubSlider
            label="Target margin"
            value={targetMargin}
            min={0}
            max={60}
            step={0.5}
            suffix="%"
            onChange={(value) => {
              setTargetMargin(value);
              setSellingPrice(null);
            }}
          />
        </div>

        <div className="ios-row flex items-center justify-between px-3.5 py-3">
          <span className="text-[14px] text-ink-secondary">
            Sell at, for {targetMargin}% margin
          </span>
          <span className="tnum text-[19px] font-bold text-accent">
            {suggested === null ? "—" : moneyExact(suggested, currency)}
          </span>
        </div>

        <div className="ios-row px-3.5 py-3">
          <label className="block text-[12px] font-medium text-ink-secondary">
            Or test a selling price
            <input
              type="number"
              step="0.01"
              value={sellingPrice ?? ""}
              placeholder={suggested ? suggested.toFixed(2) : "0.00"}
              onChange={(e) =>
                setSellingPrice(e.target.value === "" ? null : Number(e.target.value))
              }
              className="mt-1.5 h-10 w-full rounded-[10px] border border-divider bg-canvas px-3 text-[14px] tnum text-ink"
            />
          </label>
        </div>

        <FieldRow
          label="Margin implied"
          value={
            impliedMargin === null ? (
              "—"
            ) : (
              <span
                style={{
                  color:
                    impliedMargin < store.productSettings.lowMarginThresholdPct
                      ? "rgb(var(--danger))"
                      : "rgb(var(--success))",
                }}
              >
                {impliedMargin}%
              </span>
            )
          }
        />
        <FieldRow
          label="Markup implied"
          value={impliedMarkup === null ? "—" : `${impliedMarkup}%`}
        />
        <FieldRow
          label="Contribution per unit"
          value={be ? moneyExact(be.contributionPerUnit, currency) : "—"}
        />
        {fixedCost > 0 ? (
          <FieldRow
            label={`Break-even on ${money(fixedCost, currency)} fixed cost`}
            value={
              be?.units === null || be?.units === undefined
                ? "Never — no contribution at this price"
                : `${be.units.toLocaleString("en-GB")} units`
            }
          />
        ) : null}

        <div className="ios-row flex items-start gap-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-tertiary">
          <Calculator className="mt-[2px] h-3.5 w-3.5 shrink-0" />
          <span>
            Margin is taken on revenue — cost ÷ (1 − margin) — which is how a trading desk
            quotes. Using the markup formula here understates the price on every deal, and
            both figures are shown so a supplier quoting in markup can be answered directly.
          </span>
        </div>
      </Group>
    </div>
  );
}
