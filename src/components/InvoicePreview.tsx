/**
 * Invoice preview — the actual document, not a row in a list.
 *
 * Renders what the customer would receive: letterhead, both parties' details,
 * line breakdown, totals, payment position and bank details. Printing goes
 * through the browser's own print pipeline (`@media print` hides the app chrome
 * and the action bar) so a PDF comes out of Cmd/Ctrl-P with no dependency on a
 * server-side renderer.
 */
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileText,
  Mail,
  Package,
  Printer,
  type LucideIcon,
} from "lucide-react";
import { BrandGlobe } from "@/components/brand";
import { useStore } from "@/lib/store";
import type { Invoice } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { AppSection } from "@/components/Shell";

function money(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function shortDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Days overdue, or null when the invoice is settled or not yet due. */
function overdueDays(invoice: Invoice) {
  if (invoice.status === "paid" || invoice.status === "cancelled" || !invoice.dueAt) return null;
  const diff = Math.floor((Date.now() - new Date(invoice.dueAt).getTime()) / 86400000);
  return diff > 0 ? diff : null;
}

export function InvoicePreview({
  invoice,
  onBack,
  onOpenRecord,
}: {
  invoice: Invoice;
  onBack: () => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const org = store.organisation;
  const customer = store.customers.find((c) => c.id === invoice.customerId);
  const order = store.orders.find((o) => o.id === invoice.orderId);
  const quotation = order ? store.quotations.find((q) => q.id === order.quotationId) : undefined;
  const relatedEmails = store.communications.filter((c) => c.invoiceId === invoice.id);

  const paid = invoice.amountPaid ?? (invoice.status === "paid" ? invoice.total : 0);
  const balance = Math.max(0, invoice.total - paid);
  const overdue = overdueDays(invoice);

  return (
    <div className="space-y-4">
      {/* Action bar — hidden when printing */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="brand-focus inline-flex h-10 items-center gap-1.5 rounded-full border border-divider px-4 text-[13px] font-medium text-ink-secondary hover:bg-elevated hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          All invoices
        </button>

        <span className="flex-1" />

        {invoice.status !== "paid" && invoice.status !== "cancelled" ? (
          <button
            type="button"
            onClick={() => store.markInvoicePaid(invoice.id)}
            className="brand-focus inline-flex h-10 items-center gap-1.5 rounded-full bg-success px-4 text-[13px] font-semibold text-white"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark paid
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => window.print()}
          className="brand-focus inline-flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white"
        >
          <Printer className="h-4 w-4" />
          Print / PDF
        </button>
      </div>

      {/* Payment position strip */}
      <div className="no-print grid gap-3 sm:grid-cols-3">
        <StatTile label="Invoice total" value={money(invoice.total, invoice.currency)} />
        <StatTile label="Received" value={money(paid, invoice.currency)} tone="success" />
        <StatTile
          label={overdue ? `Outstanding · ${overdue} days overdue` : "Outstanding"}
          value={money(balance, invoice.currency)}
          tone={balance > 0 ? (overdue ? "alert" : "neutral") : "success"}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* The document                                                        */}
      {/* ------------------------------------------------------------------ */}
      <article className="print-sheet brand-card mx-auto w-full max-w-[860px] p-6 sm:p-10">
        {/* Letterhead */}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-divider pb-6">
          <div className="flex items-start gap-3">
            <span className="h-11 w-11 shrink-0">
              <BrandGlobe />
            </span>
            <div>
              <div className="text-[20px] font-bold leading-none tracking-tight text-ink">RENSO</div>
              <div
                className="mt-1 text-[9px] font-semibold uppercase text-ink-secondary"
                style={{ letterSpacing: "0.34em" }}
              >
                Group
              </div>
              <div className="mt-3 space-y-0.5 text-[11.5px] leading-snug text-ink-secondary">
                <div>{org.legalName}</div>
                <div>{org.addressLine1}</div>
                <div>
                  {org.city} {org.postcode}
                </div>
                <div>{org.country}</div>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-[26px] font-semibold leading-none tracking-tight text-ink">
              Invoice
            </div>
            <div className="mt-1.5 font-mono text-[14px] text-accent">{invoice.number}</div>
            <dl className="mt-4 space-y-1 text-[11.5px] leading-snug">
              <MetaRow label="Issued" value={shortDate(invoice.issuedAt ?? invoice.createdAt)} />
              <MetaRow label="Due" value={shortDate(invoice.dueAt)} />
              {invoice.paidAt ? <MetaRow label="Paid" value={shortDate(invoice.paidAt)} /> : null}
              <MetaRow label="VAT no." value={org.vatNumber ?? "—"} />
              <MetaRow label="Company no." value={org.registrationNumber ?? "—"} />
            </dl>
          </div>
        </header>

        {/* Parties */}
        <section className="grid gap-6 border-b border-divider py-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
              Invoice to
            </h3>
            {customer ? (
              <div className="space-y-0.5 text-[12.5px] leading-snug text-ink">
                <div className="text-[14px] font-semibold">{customer.name}</div>
                {customer.addressLine1 ? <div>{customer.addressLine1}</div> : null}
                {customer.addressLine2 ? <div>{customer.addressLine2}</div> : null}
                <div>
                  {customer.city} {customer.postcode}
                </div>
                <div>{customer.country}</div>
                {customer.vatNumber ? (
                  <div className="pt-1 text-ink-secondary">VAT {customer.vatNumber}</div>
                ) : null}
                {customer.email ? <div className="text-ink-secondary">{customer.email}</div> : null}
              </div>
            ) : (
              <p className="text-[13px] text-ink-secondary">Customer record not found.</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
              Terms
            </h3>
            <dl className="space-y-1 text-[12.5px] leading-snug">
              <MetaRow label="Payment terms" value={customer?.paymentTerms ?? store.salesSettings.defaultPaymentTerms} align="left" />
              <MetaRow label="Currency" value={invoice.currency} align="left" />
              {order ? <MetaRow label="Order ref" value={order.number} align="left" /> : null}
              {quotation ? <MetaRow label="Quotation ref" value={quotation.number} align="left" /> : null}
            </dl>
          </div>
        </section>

        {/* Lines */}
        <section className="py-6">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-divider text-left text-[10px] uppercase tracking-[0.08em] text-ink-tertiary">
                <th className="pb-2 font-semibold">Description</th>
                <th className="pb-2 text-right font-semibold">Qty</th>
                <th className="pb-2 text-right font-semibold">Unit price</th>
                <th className="pb-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => {
                const gross = line.quantity * line.unitPrice;
                const net = gross * (1 - (line.discountPct ?? 0) / 100);
                return (
                  <tr key={line.id} className="border-b border-divider/60 align-top">
                    <td className="py-2.5 pr-3 text-ink">
                      {line.description}
                      {line.discountPct ? (
                        <span className="ml-2 text-[11px] text-ink-tertiary">
                          less {line.discountPct}%
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                      {line.quantity.toLocaleString("en-GB")}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                      {money(line.unitPrice, invoice.currency)}
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums text-ink">
                      {money(net, invoice.currency)}
                    </td>
                  </tr>
                );
              })}
              {invoice.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink-secondary">
                    No lines on this invoice.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-5 flex justify-end">
            <dl className="w-full max-w-[280px] space-y-1.5 text-[12.5px]">
              <TotalRow label="Subtotal" value={money(invoice.subtotal, invoice.currency)} />
              <TotalRow label="VAT" value={money(invoice.tax, invoice.currency)} />
              <div className="my-1.5 h-px bg-divider" />
              <TotalRow label="Total" value={money(invoice.total, invoice.currency)} strong />
              {paid > 0 ? (
                <TotalRow label="Received" value={`− ${money(paid, invoice.currency)}`} />
              ) : null}
              {balance > 0 ? (
                <>
                  <div className="my-1.5 h-px bg-divider" />
                  <TotalRow
                    label="Balance due"
                    value={money(balance, invoice.currency)}
                    strong
                    accent
                  />
                </>
              ) : null}
            </dl>
          </div>
        </section>

        {/* Footer */}
        <footer className="space-y-3 border-t border-divider pt-5 text-[11.5px] leading-relaxed text-ink-secondary">
          {invoice.notes ? <p className="text-ink">{invoice.notes}</p> : null}
          <p>
            Please quote invoice number <span className="font-mono text-ink">{invoice.number}</span>{" "}
            with your remittance. Payment is due by {shortDate(invoice.dueAt)}.
          </p>
          <p>
            {org.legalName} · Registered in {org.country} no. {org.registrationNumber} · VAT{" "}
            {org.vatNumber} · {org.phone} · {org.email}
          </p>
        </footer>
      </article>

      {/* Linked records — screen only */}
      <div className="no-print mx-auto w-full max-w-[860px]">
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
          Connected across the platform
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {customer ? (
            <LinkTile
              icon={Building2}
              label="Customer"
              title={customer.name}
              onClick={() => onOpenRecord("customers", customer.id)}
            />
          ) : null}
          {order ? (
            <LinkTile
              icon={Package}
              label="Order"
              title={order.number}
              onClick={() => onOpenRecord("orders", order.id)}
            />
          ) : null}
          {quotation ? (
            <LinkTile
              icon={FileText}
              label="Quotation"
              title={quotation.number}
              onClick={() => onOpenRecord("quotations", quotation.id)}
            />
          ) : null}
          <LinkTile
            icon={Mail}
            label="Correspondence"
            title={`${relatedEmails.length} message${relatedEmails.length === 1 ? "" : "s"}`}
            onClick={() => onOpenRecord("email")}
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MetaRow({
  label,
  value,
  align = "right",
}: {
  label: string;
  value: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("flex gap-3", align === "right" ? "justify-end" : "justify-between")}>
      <dt className="text-ink-tertiary">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={cn(strong ? "font-semibold text-ink" : "text-ink-secondary")}>{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "text-[15px] font-semibold" : "",
          accent ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "alert";
}) {
  return (
    <div className="brand-card p-4">
      <div className="text-[12px] text-ink-secondary">{label}</div>
      <div
        className={cn(
          "mt-1.5 text-[22px] font-semibold leading-none tabular-nums tracking-tight",
          tone === "success" ? "text-success" : tone === "alert" ? "text-accent" : "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function LinkTile({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-card flex items-center gap-3 p-3 text-left transition-colors hover:border-accent/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent/10 text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-tertiary">
          {label}
        </div>
        <div className="truncate text-[13px] font-medium text-ink">{title}</div>
      </div>
    </button>
  );
}
