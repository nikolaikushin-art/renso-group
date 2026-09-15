/**
 * Accounting (requirement 12) — a bookkeeping surface an accountant can
 * actually work in, built on the same invoices, expenses and payments the
 * sales side uses. There is no second set of books to reconcile.
 *
 * Four views: profit & loss, VAT return, general ledger and expenses. Each is
 * period-scoped and exports to CSV, which is the format every accountant will
 * ask for first.
 */
import {
  ArrowDownToLine,
  BookOpen,
  Calculator,
  Check,
  Landmark,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  agedCreditors,
  financialPeriods,
  generalLedger,
  ledgerBalance,
  profitAndLoss,
  vatReturn,
} from "@/lib/accounting";
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/domain";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SegmentedControl, inputClass } from "@/components/brand";
import type { AppSection } from "@/components/Shell";

function money(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const v = String(cell ?? "");
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AccountingPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const periods = useMemo(() => financialPeriods(), []);
  const [periodLabel, setPeriodLabel] = useState(periods[0].label);
  const [view, setView] = useState<"pnl" | "vat" | "ledger" | "expenses">("pnl");
  const [addingExpense, setAddingExpense] = useState(false);

  const period = periods.find((p) => p.label === periodLabel) ?? periods[0];
  const currency = store.organisation.defaultCurrency;

  const pnl = useMemo(
    () => profitAndLoss(store.invoices, store.expenses, period),
    [store.invoices, store.expenses, period],
  );
  const vat = useMemo(
    () => vatReturn(store.invoices, store.expenses, period),
    [store.invoices, store.expenses, period],
  );
  const ledger = useMemo(
    () =>
      generalLedger(store.invoices, store.expenses, store.payments, period, {
        customer: (id) => store.customers.find((c) => c.id === id)?.name,
        supplier: (id) => store.suppliers.find((s) => s.id === id)?.name,
      }),
    [store.invoices, store.expenses, store.payments, store.customers, store.suppliers, period],
  );
  const balance = useMemo(() => ledgerBalance(ledger), [ledger]);
  const creditors = useMemo(() => agedCreditors(store.expenses), [store.expenses]);
  const creditorsTotal = creditors.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-semibold leading-none tracking-tight text-ink">
            Accounting
          </h1>
          <p className="mt-2 text-[14px] text-ink-secondary">
            Reported on an accruals basis from live CRM records — {period.label}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            className={inputClass + " h-10 w-[150px] appearance-none"}
          >
            {periods.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="lg:w-[480px]">
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { id: "pnl", label: "P&L" },
            { id: "vat", label: "VAT" },
            { id: "ledger", label: "Ledger" },
            { id: "expenses", label: "Expenses" },
          ]}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {view === "pnl" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Revenue" sub="Net of VAT" value={money(pnl.revenue, currency)} />
            <Metric
              label="Gross profit"
              sub={pnl.grossMarginPct == null ? "Margin unavailable" : `${pnl.grossMarginPct}% margin`}
              value={money(pnl.grossProfit, currency)}
            />
            <Metric
              label="Operating expenses"
              sub={`${pnl.expenseCount} entries`}
              value={money(pnl.operatingExpenses, currency)}
            />
            <Metric
              label="Net profit"
              sub={pnl.netMarginPct == null ? "—" : `${pnl.netMarginPct}% of revenue`}
              value={money(pnl.netProfit, currency)}
              tone={pnl.netProfit >= 0 ? "success" : "alert"}
            />
          </div>

          {pnl.costsIncomplete ? (
            <div className="brand-card flex items-start gap-3 p-4">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="text-[13px] leading-relaxed text-ink-secondary">
                This period has revenue but no cost of sales booked, so gross margin
                is shown as unavailable rather than 100%. Add purchase costs under
                Expenses to make margin a measured figure.
              </p>
            </div>
          ) : null}

          <div className="brand-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-divider px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-ink">
                Profit &amp; loss — {period.label}
              </h2>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(`renso-pnl-${period.label.replace(/\s/g, "-")}.csv`, [
                    ["Line", "Amount", "Currency"],
                    ["Revenue", pnl.revenue, currency],
                    ["Cost of sales", -pnl.costOfSales, currency],
                    ["Gross profit", pnl.grossProfit, currency],
                    ...pnl.expensesByCategory.map((c) => [
                      EXPENSE_CATEGORY_LABELS[c.category],
                      -c.amount,
                      currency,
                    ]),
                    ["Net profit", pnl.netProfit, currency],
                  ])
                }
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
            <div className="divide-y divide-divider">
              <PnlRow label="Revenue" value={money(pnl.revenue, currency)} strong />
              <PnlRow label="Cost of sales" value={`(${money(pnl.costOfSales, currency)})`} />
              <PnlRow label="Gross profit" value={money(pnl.grossProfit, currency)} strong accent />
              {pnl.expensesByCategory
                .filter((c) => c.category !== "purchases" && c.category !== "freight_duty")
                .map((c) => (
                  <PnlRow
                    key={c.category}
                    label={EXPENSE_CATEGORY_LABELS[c.category]}
                    value={`(${money(c.amount, currency)})`}
                    indent
                  />
                ))}
              <PnlRow
                label="Total operating expenses"
                value={`(${money(pnl.operatingExpenses, currency)})`}
              />
              <PnlRow label="Net profit" value={money(pnl.netProfit, currency)} strong accent />
            </div>
          </div>

          <div className="brand-card p-5">
            <h2 className="text-[14px] font-semibold text-ink">Aged creditors</h2>
            <p className="mt-0.5 text-[12px] text-ink-tertiary">
              Unpaid purchases and overheads — {money(creditorsTotal, currency)} owed.
            </p>
            <div className="mt-4 space-y-3">
              {creditors.map((b) => (
                <div key={b.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium text-ink">{b.label}</span>
                    <span className="text-[13px] tabular-nums text-ink-secondary">
                      {b.count} · {money(b.amount, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{
                        width: `${creditorsTotal ? (b.amount / creditorsTotal) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {view === "vat" ? (
        <div className="space-y-4">
          <div className="brand-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-divider px-5 py-3.5">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">VAT return — {period.label}</h2>
                <p className="mt-0.5 text-[12px] text-ink-tertiary">
                  UK box numbering, ready to type into a submission.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(`renso-vat-${period.label.replace(/\s/g, "-")}.csv`, [
                    ["Box", "Description", "Amount"],
                    [1, "VAT due on sales", vat.box1_outputVat],
                    [2, "VAT due on EC acquisitions", 0],
                    [3, "Total VAT due", vat.box3_totalOutputVat],
                    [4, "VAT reclaimed on purchases", vat.box4_inputVat],
                    [5, "Net VAT due", vat.box5_netDue],
                    [6, "Total sales ex VAT", vat.box6_totalSalesExVat],
                    [7, "Total purchases ex VAT", vat.box7_totalPurchasesExVat],
                  ])
                }
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
            <div className="divide-y divide-divider">
              <VatBox n={1} label="VAT due on sales and other outputs" value={money(vat.box1_outputVat, currency)} />
              <VatBox n={2} label="VAT due on acquisitions from EC member states" value={money(0, currency)} muted />
              <VatBox n={3} label="Total VAT due" value={money(vat.box3_totalOutputVat, currency)} strong />
              <VatBox n={4} label="VAT reclaimed on purchases and other inputs" value={money(vat.box4_inputVat, currency)} />
              <VatBox
                n={5}
                label={vat.box5_netDue >= 0 ? "Net VAT due to HMRC" : "Net VAT reclaimable from HMRC"}
                value={money(Math.abs(vat.box5_netDue), currency)}
                strong
                accent
              />
              <VatBox n={6} label="Total value of sales excluding VAT" value={money(vat.box6_totalSalesExVat, currency)} />
              <VatBox n={7} label="Total value of purchases excluding VAT" value={money(vat.box7_totalPurchasesExVat, currency)} />
            </div>
            <div className="border-t border-divider bg-canvas/40 px-5 py-3 text-[11.5px] leading-relaxed text-ink-tertiary">
              Boxes 2, 8 and 9 are held at zero: the CRM does not yet capture EC
              acquisition and dispatch data, and a guessed figure on a statutory
              return is worse than an obvious zero. Drawn from {vat.salesCount} sales
              and {vat.purchasesCount} purchase records.
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {view === "ledger" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium",
                balance.balanced ? "bg-success/10 text-success" : "bg-accent/10 text-accent",
              )}
            >
              {balance.balanced ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {balance.balanced ? "Journal balances" : "Journal does not balance"}
            </div>
            <span className="text-[12.5px] tabular-nums text-ink-secondary">
              Dr {money(balance.debit, currency)} · Cr {money(balance.credit, currency)}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() =>
                downloadCsv(`renso-ledger-${period.label.replace(/\s/g, "-")}.csv`, [
                  ["Date", "Reference", "Account", "Description", "Entity", "Debit", "Credit", "Currency"],
                  ...ledger.map((e) => [
                    shortDate(e.date),
                    e.reference,
                    e.account,
                    e.description,
                    e.entityName ?? "",
                    e.debit || "",
                    e.credit || "",
                    e.currency,
                  ]),
                ])
              }
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>

          <div className="brand-card overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12.5px]">
              <thead>
                <tr className="border-b border-divider text-left text-[10px] uppercase tracking-[0.08em] text-ink-tertiary">
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold">Ref</th>
                  <th className="px-4 py-2.5 font-semibold">Account</th>
                  <th className="px-4 py-2.5 font-semibold">Description</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {ledger.map((e) => (
                  <tr
                    key={e.id}
                    className="cursor-pointer transition-colors hover:bg-elevated"
                    onClick={() =>
                      e.source === "invoice" || e.source === "receipt"
                        ? onOpenRecord("invoices", e.source === "invoice" ? e.sourceId : undefined)
                        : setView("expenses")
                    }
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-secondary">
                      {shortDate(e.date)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11.5px] text-ink-secondary">
                      {e.reference}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">{e.account}</td>
                    <td className="px-4 py-2.5 text-ink-secondary">{e.description}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {e.debit ? money(e.debit, e.currency) : ""}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                      {e.credit ? money(e.credit, e.currency) : ""}
                    </td>
                  </tr>
                ))}
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ink-secondary">
                      No postings in {period.label}.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {view === "expenses" ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[13px] text-ink-secondary">
              {store.expenses.length} expense{store.expenses.length === 1 ? "" : "s"} ·{" "}
              {money(creditorsTotal, currency)} unpaid
            </span>
            <button
              type="button"
              onClick={() => setAddingExpense(true)}
              className="brand-focus inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Add expense
            </button>
          </div>

          <div className="brand-card divide-y divide-divider overflow-hidden">
            {store.expenses.map((e) => (
              <div key={e.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                    e.isPaid ? "bg-success/10 text-success" : "bg-accent/10 text-accent",
                  )}
                >
                  <Receipt className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-ink">{e.description}</div>
                  <div className="truncate text-[12.5px] text-ink-secondary">
                    {EXPENSE_CATEGORY_LABELS[e.category]}
                    {e.supplierName ? ` · ${e.supplierName}` : ""} · {shortDate(e.date)}
                  </div>
                </div>
                <div className="text-right sm:w-[130px]">
                  <div className="text-[14px] font-semibold tabular-nums text-ink">
                    {money(e.net + e.vat, e.currency)}
                  </div>
                  {e.vat > 0 ? (
                    <div className="text-[11.5px] tabular-nums text-ink-tertiary">
                      incl. {money(e.vat, e.currency)} VAT
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.isPaid ? (
                    <span className="rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success">
                      Paid
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        store.recordSupplierPayment({ expenseId: e.id, amount: e.net + e.vat })
                      }
                      className="rounded-full border border-divider px-2.5 py-1 text-[11.5px] font-medium text-ink-secondary hover:bg-elevated hover:text-ink"
                    >
                      Mark paid
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => store.removeExpense(e.id)}
                    aria-label="Delete expense"
                    className="rounded-lg p-1.5 text-ink-tertiary hover:bg-elevated hover:text-ink"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {store.expenses.length === 0 ? (
              <p className="px-4 py-12 text-center text-[13px] text-ink-secondary">
                No expenses recorded. Add purchases to make gross margin a measured figure.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Connector status */}
      <div className="brand-card flex flex-wrap items-center gap-3 border-dashed p-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-elevated text-ink-secondary">
          <Landmark className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-ink">External accounting connector</div>
          <div className="text-[12.5px] text-ink-secondary">
            Provider-agnostic, Xero-ready. Everything above exports to CSV in the
            meantime, so an accountant is never blocked on the integration.
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-[11px] font-semibold text-ink-secondary">
          Not connected
        </span>
      </div>

      {addingExpense ? (
        <ExpenseForm onClose={() => setAddingExpense(false)} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ExpenseForm({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("purchases");
  const [supplierId, setSupplierId] = useState("");
  const [net, setNet] = useState("");
  const [vat, setVat] = useState("");
  const [currency, setCurrency] = useState(store.organisation.defaultCurrency);
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const valid = description.trim().length > 0 && Number(net) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-divider bg-surface sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-divider px-5 py-3.5">
          <Calculator className="h-4 w-4 text-accent" />
          <h3 className="flex-1 text-[15px] font-semibold text-ink">New expense</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-secondary hover:bg-elevated">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className={inputClass + " appearance-none"}
            >
              {Object.entries(EXPENSE_CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier (optional)">
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputClass + " appearance-none"}
            >
              <option value="">—</option>
              {store.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Net">
              <input type="number" value={net} onChange={(e) => setNet(e.target.value)} className={inputClass} />
            </Field>
            <Field label="VAT">
              <input type="number" value={vat} onChange={(e) => setVat(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Currency">
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Reference">
              <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
            </Field>
          </div>
        </div>

        <div className="flex gap-2 border-t border-divider px-5 py-3.5">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              store.addExpense({
                description: description.trim(),
                category,
                supplierId: supplierId || undefined,
                net: Number(net) || 0,
                vat: Number(vat) || 0,
                currency,
                reference: reference.trim() || undefined,
                date: new Date(date).toISOString(),
              });
              onClose();
            }}
            className={cn(
              "brand-focus h-10 flex-1 rounded-full text-[14px] font-semibold",
              valid ? "bg-accent text-white" : "cursor-not-allowed bg-elevated text-ink-tertiary",
            )}
          >
            Save expense
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-full border border-divider px-5 text-[13px] font-medium text-ink-secondary hover:bg-elevated"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
        {label}
      </div>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "alert";
}) {
  return (
    <div className="brand-card p-5">
      <div className="text-[13px] font-semibold text-ink">{label}</div>
      <div className="brand-underline mb-3 mt-1.5" />
      <div
        className={cn(
          "text-[26px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "success" ? "text-ink" : tone === "alert" ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-2 text-[12px] text-ink-tertiary">{sub}</div> : null}
    </div>
  );
}

function PnlRow({
  label,
  value,
  strong,
  accent,
  indent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-5 py-3", indent && "pl-9")}>
      <span
        className={cn(
          "text-[13.5px]",
          strong ? "font-semibold text-ink" : "text-ink-secondary",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-[15px] font-semibold" : "text-[13.5px]",
          accent ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function VatBox({
  n,
  label,
  value,
  strong,
  accent,
  muted,
}: {
  n: number;
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[12px] font-semibold",
          accent ? "bg-accent text-white" : "bg-elevated text-ink-secondary",
        )}
      >
        {n}
      </span>
      <span
        className={cn(
          "flex-1 text-[13.5px]",
          muted ? "text-ink-tertiary" : strong ? "font-semibold text-ink" : "text-ink-secondary",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          strong ? "text-[15px] font-semibold" : "text-[13.5px]",
          accent ? "text-accent" : muted ? "text-ink-tertiary" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export { BookOpen };
