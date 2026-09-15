import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Target,
  Brain,
  ChevronRight,
  ArrowDownLeft,
  Building2,
  UserRound,
  KeyRound,
  Mail,
  MessageCircle,
  Send,
  Wallet,
  FileText,
  ScrollText,
  Palette,
  Database,
  Search,
  Package,
  Users,
  Plus,
  Pencil,
  Trash2,
  Scale,
  Lock,
  Contact,
  Truck,
  ClipboardList,
  ShoppingCart,
  Receipt,
  FolderOpen,
  ShieldCheck,
  Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useStore, type OpportunityInput } from "@/lib/store";
import { blankLine, computeTotals, lineNet, type DraftLine } from "@/lib/lines";
import { relativeDay, shortDate } from "@/lib/format";
import { staleRates } from "@/lib/fx";
import {
  countDelta,
  openOrderValue,
  pipelineByStage,
  quotationConversion,
  receivablesAging,
  resolvePeriod,
  revenueByManager,
  revenueByMonth,
  revenueByTerritory,
  revenueDelta,
  winRate,
  type Delta,
  type PeriodDays,
} from "@/lib/analytics";

// recharts is only needed for the one chart on the dashboard, so it is split out
// of the main bundle rather than paid for on every page load.
const RevenueTrendChart = lazy(() => import("@/components/RevenueTrendChart"));
import {
  documentExpiry,
  documentsNeedingAttention,
  expiryLabel,
  type ExpiryInfo,
  type ExpiryState,
} from "@/lib/documents";
import { scoreCustomers, scoreSuppliers, supplierMarketPositions, livePriceCompetitiveness, type ScoreComponents } from "@/lib/scoring";
import type {
  Customer,
  Document,
  Opportunity,
  OpportunityStage,
  OrderStatus,
  PricingRecord,
  QuotationLine,
  QuotationStatus,
  Supplier,
  Role,
} from "@/lib/domain";
import { ROLE_LABELS } from "@/lib/domain";
import { AppShell, type AppSection, sectionLabel, useTheme } from "@/components/Shell";
import {
  BrandCard,
  SectionHeader,
  PrimaryButton,
  EmptyState,
  SegmentedControl,
  AccentRule,
  inputClass,
  StatBlock,
} from "@/components/brand";
import { MailModule } from "@/components/MailModule";
import { WhatsAppModule } from "@/components/WhatsAppModule";
import { OrdersPage } from "@/components/OrdersPage";
import { Pill, StatusPill as IOSStatusPill, type PillTone } from "@/components/ios";
import { RequirementsPage, KycPage, PortfolioPage } from "@/components/CommercialPages";
import { CampaignsPage } from "@/components/CampaignsPage";
import { InvoicePreview } from "@/components/InvoicePreview";
import { AccountingPage } from "@/components/AccountingPage";
// The four intelligence modules are split out of the main bundle. They are
// the heaviest pages in the app and nobody lands on them first, so paying for
// them on every cold load would slow down the pages people do land on.
const SignalsPage = lazy(() =>
  import("@/components/SignalsPage").then((m) => ({ default: m.SignalsPage })),
);
const DealDeskPage = lazy(() =>
  import("@/components/DealDeskPage").then((m) => ({ default: m.DealDeskPage })),
);
const CreditControlPage = lazy(() =>
  import("@/components/CreditControlPage").then((m) => ({ default: m.CreditControlPage })),
);
const PriceIntelPage = lazy(() =>
  import("@/components/PriceIntelPage").then((m) => ({ default: m.PriceIntelPage })),
);
import { useLiveSignals } from "@/lib/useSignals";
import { ActivityRings, NumberTicker, SeverityDot } from "@/components/apple";
import {
  CommsActivityPanel,
  ProductProfitabilityPanel,
  ProfitWaterfallPanel,
  ReliabilityPanel,
} from "@/components/InsightPanels";

function formatMoney(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Two-decimal variant for line-level and document-level arithmetic, where
 *  rounding to whole units would make the totals look wrong. */
function formatMoneyExact(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function downloadText(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

/**
 * Every status chip in the app now resolves through one shared vocabulary
 * (`ios.tsx`), so "paid" is the same green on the invoice list, the order row
 * and the payment queue. The previous local map rendered almost everything as
 * either navy or grey, which is why the modules read as flat and undifferentiated
 * — you could not tell a healthy record from a stuck one at a glance.
 */
function StatusBadge({ status }: { status: string }) {
  return <IOSStatusPill status={status} />;
}

export function RensoApp() {
  const store = useStore();
  const [section, setSection] = useState<AppSection>("dashboard");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [preselectCustomerId, setPreselectCustomerId] = useState<string | null>(null);
  const [preselectQuoteCustomerId, setPreselectQuoteCustomerId] = useState<string | null>(null);
  /**
   * Cross-module drill-down target.
   *
   * Every module can ask to open a specific record in another module via
   * `openRecord(section, id)` — the mail reading pane jumping to the invoice it
   * refers to, the invoice preview jumping back to the customer, and so on.
   * The id is consumed by whichever page renders next and cleared on the way
   * out, so a later manual visit to that section doesn't reopen a stale record.
   */
  const [focus, setFocus] = useState<{ section: AppSection; id?: string } | null>(null);
  const metrics = store.getMetrics();

  const openRecord = useCallback((next: AppSection, id?: string) => {
    if (next === "customers" && id) setPreselectCustomerId(id);
    setFocus(id ? { section: next, id } : null);
    setSection(next);
  }, []);

  // Clear the drill-down target once we've navigated away from Customers, so a
  // later manual visit to the section doesn't reopen a stale record.
  useEffect(() => {
    if (section !== "customers") setPreselectCustomerId(null);
  }, [section]);

  // Same pattern for "New quotation" shortcuts fired from Customer/Supplier
  // detail — they navigate here with a customer already chosen rather than
  // reopening a stale prefill on a later manual visit.
  useEffect(() => {
    if (section !== "quotations") setPreselectQuoteCustomerId(null);
  }, [section]);

  useEffect(() => {
    setFocus((f) => (f && f.section !== section ? null : f));
  }, [section]);

  const focusId = focus?.section === section ? focus.id : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const renderPage = () => {
    switch (section) {
      case "dashboard":
        return (
          <Dashboard
            metrics={metrics}
            onNavigate={(s) => setSection(s as AppSection)}
            onOpenCustomer={(id) => {
              setPreselectCustomerId(id);
              setSection("customers");
            }}
            onOpenRecord={openRecord}
          />
        );
      case "customers":
        return (
          <EntityList
            title="Customers"
            items={store.customers}
            type="customer"
            initialDetailId={preselectCustomerId}
            onCreateQuotationFor={(customerId) => {
              setPreselectQuoteCustomerId(customerId);
              setSection("quotations");
            }}
          />
        );
      case "contacts":
        return <ContactsPage />;
      case "suppliers":
        return <EntityList title="Suppliers" items={store.suppliers} type="supplier" />;
      case "products":
        return <ProductsPage />;
      case "pricing":
        return <PricingIntelligence />;
      case "quotations":
        return <QuotationsPage initialCustomerId={preselectQuoteCustomerId} />;
      case "orders":
        return <OrdersPage initialOrderId={focusId} onOpenRecord={openRecord} />;
      case "invoices":
        return <InvoicesPage initialInvoiceId={focusId} onOpenRecord={openRecord} />;
      case "kyc":
        return <KycPage onOpenRecord={openRecord} />;
      case "documents":
        return <DocumentsPage />;
      case "portfolio":
        return <PortfolioPage onOpenRecord={openRecord} />;
      case "requirements":
        return <RequirementsPage onOpenRecord={openRecord} />;
      case "opportunities":
        return <OpportunitiesPage />;
      case "email":
        return <MailModule channel="email" onOpenRecord={openRecord} />;
      case "whatsapp":
        return <WhatsAppModule onOpenRecord={openRecord} />;
      case "campaigns":
        return <CampaignsPage onOpenRecord={openRecord} />;
      case "accounting":
        return <AccountingPage onOpenRecord={openRecord} />;
      case "payments":
        return <PaymentsPage onOpenRecord={openRecord} />;
      case "signals":
        // Signal targets are named after sections, so the engine can point at
        // a module without importing the navigation type.
        return <SignalsPage onOpenRecord={(target, id) => openRecord(target as AppSection, id)} />;
      case "dealdesk":
        return <DealDeskPage onOpenRecord={openRecord} />;
      case "credit":
        return <CreditControlPage onOpenRecord={openRecord} />;
      case "priceintel":
        return <PriceIntelPage onOpenRecord={openRecord} />;
      case "scoring":
        return <ScoringPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return (
          <EmptyModule
            title={sectionLabel(section)}
            message="This module is ready for data. Connect integrations or import records to populate it."
          />
        );
    }
  };

  return (
    <AppShell
      section={section}
      onSelect={setSection}
      onOpenSearch={() => {
        setSearchQuery("");
        setSearchIndex(0);
        setSearchOpen(true);
      }}
    >
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <Suspense
          fallback={
            <div className="space-y-3">
              <div className="skeleton h-9 w-56" />
              <div className="skeleton h-[120px] w-full" />
              <div className="skeleton h-[220px] w-full" />
            </div>
          }
        >
          {renderPage()}
        </Suspense>
      </div>
      {searchOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onClick={() => setSearchOpen(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-divider renso-glass shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-divider px-4 py-3.5">
              <Search className="h-4 w-4 shrink-0 text-ink-tertiary" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchIndex(0);
                }}
                onKeyDown={(e) => {
                  const results = searchIndexResults(store, searchQuery);
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSearchIndex((i) => Math.min(i + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSearchIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const pick = results[searchIndex];
                    if (pick) {
                      // Open the record, not just its module. Landing on a
                      // list of four hundred customers after searching for one
                      // by name is the search working and the app ignoring it.
                      openRecord(pick.section, pick.id);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }
                  }
                }}
                placeholder="Search everything — customers, orders, documents…"
                className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-tertiary"
              />
              <kbd className="shrink-0 rounded border border-divider px-1.5 py-0.5 text-[10px] text-ink-tertiary">esc</kbd>
            </div>
            {searchQuery.trim() ? (
              <GlobalSearchResults
                query={searchQuery}
                store={store}
                selectedIndex={searchIndex}
                onHover={setSearchIndex}
                onNavigate={(next, id) => {
                  openRecord(next, id);
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
              />
            ) : (
              <p className="px-4 py-5 text-[13px] text-ink-tertiary">
                Search across customers, suppliers, contacts, products, pricing, opportunities,
                quotations, orders, invoices and documents — one box for the whole platform.
              </p>
            )}
            <div className="flex items-center gap-3 border-t border-divider bg-canvas/40 px-4 py-2 text-[11px] text-ink-tertiary">
              <span className="flex items-center gap-1"><kbd className="rounded border border-divider px-1">↑↓</kbd> navigate</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-divider px-1">↵</kbd> open</span>
              <span className="flex items-center gap-1"><kbd className="rounded border border-divider px-1">esc</kbd> close</span>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  section: AppSection;
  category: string;
  icon: LucideIcon;
};

/** Builds the flat, ranked result list shared by keyboard nav and rendering. */
function searchIndexResults(store: ReturnType<typeof useStore>, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const all: SearchResult[] = [
    ...store.customers.map((x) => ({ id: x.id, label: x.name, detail: `${x.country} · Customer`, section: "customers" as AppSection, category: "Customers", icon: Users })),
    ...store.suppliers.map((x) => ({ id: x.id, label: x.name, detail: `${x.country} · Supplier`, section: "suppliers" as AppSection, category: "Suppliers", icon: Truck })),
    ...store.contacts.map((x) => ({ id: x.id, label: `${x.firstName} ${x.lastName}`, detail: x.email || "No email", section: "contacts" as AppSection, category: "Contacts", icon: Contact })),
    ...store.products.map((x) => ({ id: x.id, label: x.name, detail: x.sku, section: "products" as AppSection, category: "Products", icon: Package })),
    ...store.pricingRecords.map((x) => ({ id: x.id, label: x.productName, detail: `Offer from ${x.supplierName}`, section: "pricing" as AppSection, category: "Pricing & offers", icon: Brain })),
    ...store.opportunities.map((x) => ({ id: x.id, label: x.title, detail: `${x.stage} · ${x.currency} ${x.value ?? 0}`, section: "opportunities" as AppSection, category: "Opportunities", icon: TrendingUp })),
    ...store.quotations.map((x) => ({ id: x.id, label: x.number, detail: x.notes || x.status, section: "quotations" as AppSection, category: "Quotations", icon: ClipboardList })),
    ...store.orders.map((x) => ({ id: x.id, label: x.number, detail: x.status, section: "orders" as AppSection, category: "Orders", icon: ShoppingCart })),
    ...store.invoices.map((x) => ({ id: x.id, label: x.number, detail: x.status, section: "invoices" as AppSection, category: "Invoices", icon: Receipt })),
    ...store.documents.map((x) => ({ id: x.id, label: x.name, detail: `${x.type} document`, section: "documents" as AppSection, category: "Documents", icon: FolderOpen })),
    ...store.kycRecords.map((x) => ({
      id: x.id,
      label: store.customers.find((c) => c.id === x.customerId)?.name || "KYC record",
      detail: `KYC · ${x.status.replace("_", " ")}`,
      section: "kyc" as AppSection,
      category: "KYC",
      icon: ShieldCheck,
    })),
  ];
  return all
    .filter((x) => `${x.label} ${x.detail} ${x.category}`.toLowerCase().includes(needle))
    .slice(0, 24);
}

function GlobalSearchResults({
  query,
  store,
  selectedIndex,
  onHover,
  onNavigate,
}: {
  query: string;
  store: ReturnType<typeof useStore>;
  selectedIndex: number;
  onHover: (i: number) => void;
  onNavigate: (section: AppSection, id: string) => void;
}) {
  const results = searchIndexResults(store, query);
  const groups = new Map<string, SearchResult[]>();
  results.forEach((r) => {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category)!.push(r);
  });

  if (!results.length) {
    return <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No matching records.</div>;
  }

  let flatIndex = -1;
  return (
    <div className="thin-scroll max-h-[52vh] overflow-y-auto py-1.5">
      {Array.from(groups.entries()).map(([category, items]) => (
        <div key={category}>
          <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            {category}
          </div>
          {items.map((result) => {
            flatIndex += 1;
            const active = flatIndex === selectedIndex;
            const Icon = result.icon;
            return (
              <button
                key={`${result.section}-${result.id}`}
                type="button"
                onMouseEnter={() => onHover(flatIndex)}
                onClick={() => onNavigate(result.section, result.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                  active ? "bg-accent/10" : "hover:bg-elevated",
                )}
              >
                <div className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                  active ? "bg-accent text-white" : "bg-elevated text-ink-secondary",
                )}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{result.label}</span>
                  <span className="block truncate text-[12px] text-ink-tertiary">{result.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

type ActivityEvent = {
  id: string;
  at: string;
  label: string;
  detail: string;
  section: AppSection;
  icon: LucideIcon;
};

/**
 * Unifies the last events across every commercial module — quotations,
 * orders, invoices, documents and KYC — into one chronological feed, so the
 * dashboard reads as one connected ecosystem rather than separate silos.
 */
function buildActivityFeed(store: ReturnType<typeof useStore>): ActivityEvent[] {
  const customerName = (id: string) => store.customers.find((c) => c.id === id)?.name || "Unknown account";
  const events: ActivityEvent[] = [
    ...store.quotations.map((q) => ({
      id: `q-${q.id}`,
      at: q.updatedAt,
      label: `Quotation ${q.number} — ${q.status}`,
      detail: customerName(q.customerId),
      section: "quotations" as AppSection,
      icon: ClipboardList,
    })),
    ...store.orders.map((o) => ({
      id: `o-${o.id}`,
      at: o.updatedAt,
      label: `Order ${o.number} — ${o.status}`,
      detail: customerName(o.customerId),
      section: "orders" as AppSection,
      icon: ShoppingCart,
    })),
    ...store.invoices.map((i) => ({
      id: `i-${i.id}`,
      at: i.updatedAt,
      label: `Invoice ${i.number} — ${i.status}`,
      detail: customerName(i.customerId),
      section: "invoices" as AppSection,
      icon: Receipt,
    })),
    ...store.documents.map((d) => ({
      id: `d-${d.id}`,
      at: d.createdAt,
      label: `Document added — ${d.name}`,
      detail: d.customerId ? customerName(d.customerId) : d.type,
      section: "documents" as AppSection,
      icon: FolderOpen,
    })),
    ...store.kycRecords.map((k) => ({
      id: `k-${k.id}`,
      at: k.updatedAt,
      label: `KYC ${k.status.replace("_", " ")}`,
      detail: customerName(k.customerId),
      section: "kyc" as AppSection,
      icon: ShieldCheck,
    })),
  ];
  return events
    .filter((e) => !!e.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 7);
}

const PERIOD_OPTIONS: { id: string; label: string; days: PeriodDays }[] = [
  { id: "30", label: "30 days", days: 30 },
  { id: "90", label: "90 days", days: 90 },
  { id: "365", label: "12 months", days: 365 },
  { id: "all", label: "All time", days: null },
];

/** Signed, coloured percentage change against the preceding period. */
function DeltaPill({ value, periodLabel }: { value: Delta; periodLabel: string }) {
  if (value.changePct == null) {
    return <span className="text-[12px] text-ink-tertiary">No prior {periodLabel} to compare</span>;
  }
  const up = value.changePct > 0;
  const flat = value.changePct === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium",
        flat ? "text-ink-tertiary" : up ? "text-[rgb(var(--success))]" : "text-accent",
      )}
    >
      {flat ? null : up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {flat ? "No change" : `${up ? "+" : ""}${value.changePct}%`}
      <span className="text-ink-tertiary font-normal">vs prior {periodLabel}</span>
    </span>
  );
}

/**
 * Horizontal proportion bar. Used for breakdowns where a pie would be harder to
 * read at these category counts and harder to scan against a label column.
 */
function ProportionBar({ share }: { share: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
      />
    </div>
  );
}

/** Consistent iOS-style back navigation link, used at the top of every detail/form screen. */
function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="brand-focus -ml-1.5 inline-flex items-center gap-0.5 rounded-lg py-1 pl-1.5 pr-2.5 text-[15px] font-medium text-accent transition-transform active:scale-[0.97]"
    >
      <ChevronRight className="h-4 w-4 rotate-180" strokeWidth={2.5} />
      {label}
    </button>
  );
}

function ChartCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="brand-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-ink-tertiary">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Dashboard({
  metrics,
  onNavigate,
  onOpenCustomer,
  onOpenRecord,
}: {
  metrics: ReturnType<ReturnType<typeof useStore>["getMetrics"]>;
  onNavigate: (p: string) => void;
  onOpenCustomer: (id: string) => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const signals = useLiveSignals();
  const criticalSignals = signals.filter((s) => s.severity === "critical").length;
  const highSignals = signals.filter((s) => s.severity === "high").length;
  const [periodId, setPeriodId] = useState("90");
  const [breakdown, setBreakdown] = useState<"territory" | "manager">("territory");
  const [insight, setInsight] = useState<"products" | "profit" | "comms" | "reliability">(
    "products",
  );

  const periodOption = PERIOD_OPTIONS.find((p) => p.id === periodId) || PERIOD_OPTIONS[1];
  const period = useMemo(() => resolvePeriod(periodOption.days), [periodOption.days]);
  const periodLabel = periodOption.days == null ? "period" : `${periodOption.days} days`;

  const revenue = useMemo(() => revenueDelta(store.invoices, period), [store.invoices, period]);
  const newOpportunities = useMemo(
    () => countDelta(store.opportunities, period),
    [store.opportunities, period],
  );
  const trend = useMemo(() => revenueByMonth(store.invoices, 12), [store.invoices]);
  const stages = useMemo(() => pipelineByStage(store.opportunities), [store.opportunities]);
  const rate = useMemo(() => winRate(store.opportunities), [store.opportunities]);
  const conversion = useMemo(() => quotationConversion(store.quotations), [store.quotations]);
  const aging = useMemo(() => receivablesAging(store.invoices), [store.invoices]);
  const inFlight = useMemo(() => openOrderValue(store.orders), [store.orders]);
  const activity = useMemo(() => buildActivityFeed(store), [store]);
  const splits = useMemo(
    () =>
      breakdown === "territory"
        ? revenueByTerritory(store.customers, store.invoices)
        : revenueByManager(store.customers, store.invoices, store.users),
    [breakdown, store.customers, store.invoices, store.users],
  );

  const documentAlerts = metrics.documentsExpired + metrics.documentsExpiring;
  const stagePeak = Math.max(1, ...stages.map((s) => s.value));
  const splitTotal = splits.reduce((sum, s) => sum + s.revenue, 0);
  const agingTotal = aging.reduce((sum, b) => sum + b.amount, 0);
  const overdueTotal = agingTotal - aging[0].amount;

  const cards = [
    {
      label: "Revenue",
      value: formatMoney(revenue.current),
      delta: revenue,
      sub: "Issued and paid invoices",
      icon: TrendingUp,
      nav: "invoices",
    },
    {
      label: "Order book",
      value: formatMoney(inFlight),
      sub: "Confirmed, not yet delivered",
      icon: Package,
      nav: "orders",
    },
    {
      label: "Open pipeline",
      value: formatMoney(stages.reduce((sum, s) => sum + s.value, 0)),
      delta: newOpportunities,
      sub: `${metrics.openOpportunities} live opportunities`,
      icon: Target,
      nav: "opportunities",
    },
    {
      label: "Overdue receivables",
      value: formatMoney(overdueTotal),
      sub: `${formatMoney(agingTotal)} outstanding in total`,
      icon: Wallet,
      alert: overdueTotal > 0,
      nav: "payments",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[34px] font-semibold tracking-tight text-ink leading-none">Dashboard</h1>
          <p className="text-[14px] text-ink-secondary mt-2">
            {store.user?.name ? `Good day, ${store.user.name.split(" ")[0]}` : "Good day"} · Renso Group · London
          </p>
        </div>
        <div className="lg:w-[360px]">
          <SegmentedControl
            value={periodId}
            onChange={setPeriodId}
            options={PERIOD_OPTIONS.map((p) => ({ id: p.id, label: p.label }))}
          />
        </div>
      </div>

      {(metrics.followUpsDue > 0 || metrics.newOffers > 0 || documentAlerts > 0) && (
        <div className="brand-card px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-ink">Needs attention</div>
            <div className="text-[13px] text-ink-secondary mt-0.5">
              {[
                metrics.followUpsDue > 0 ? `${metrics.followUpsDue} quotation follow-up(s)` : null,
                metrics.newOffers > 0 ? `${metrics.newOffers} AI pricing review(s)` : null,
                metrics.documentsExpired > 0 ? `${metrics.documentsExpired} document(s) expired` : null,
                metrics.documentsExpiring > 0 ? `${metrics.documentsExpiring} document(s) expiring` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            {metrics.followUpsDue > 0 ? (
              <Button type="button" variant="secondary" onClick={() => onNavigate("quotations")}>
                Open quotations
              </Button>
            ) : null}
            {documentAlerts > 0 ? (
              <Button type="button" variant="secondary" onClick={() => onNavigate("documents")}>
                Open documents
              </Button>
            ) : null}
            {metrics.newOffers > 0 ? (
              <Button type="button" onClick={() => onNavigate("pricing")}>
                Review pricing
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {/* Signal strip.
          The dashboard says how the business is doing; this says what to do
          about it before lunch. Three rows only — the rest is one tap away,
          and a dashboard that lists twenty actions gets read as wallpaper. */}
      <button
        type="button"
        onClick={() => onNavigate("signals")}
        className="brand-card brand-card-hover flex w-full items-center gap-5 p-5 text-left"
      >
        <ActivityRings
          size={78}
          thickness={8}
          rings={[
            { label: "Critical", value: criticalSignals / 5, token: "--danger" },
            { label: "High", value: highSignals / 8, token: "--accent" },
            {
              label: "Rest",
              value: (signals.length - criticalSignals - highSignals) / 14,
              token: "--caution",
            },
          ]}
          centre={
            <NumberTicker
              value={signals.length}
              className="text-[20px] font-bold leading-none tracking-tight text-ink"
            />
          }
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-semibold text-ink">Signals</p>
            {criticalSignals > 0 ? <SeverityDot token="--danger" pulse /> : null}
          </div>
          <div className="brand-underline mt-1.5 mb-2.5" />
          {signals.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">
              Nothing needs attention — every invoice is inside terms, every document is in
              date, and no quotation is past its follow-up.
            </p>
          ) : (
            <ul className="space-y-1">
              {signals.slice(0, 3).map((signal) => (
                <li key={signal.id} className="flex items-start gap-2 text-[12.5px]">
                  <span className="mt-[5px]">
                    <SeverityDot
                      token={
                        signal.severity === "critical"
                          ? "--danger"
                          : signal.severity === "high"
                            ? "--accent"
                            : "--caution"
                      }
                    />
                  </span>
                  <span className="min-w-0 truncate text-ink-secondary">
                    <span className="font-medium text-ink">{signal.title}</span>
                    {signal.action ? ` — ${signal.action}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ChevronRight className="hidden h-4 w-4 shrink-0 text-ink-tertiary sm:block" />
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => onNavigate(c.nav)}
            className="brand-card brand-card-hover p-5 text-left w-full transition-transform active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{c.label}</p>
                <div className="brand-underline mt-1.5 mb-3" />
                <p className="renso-metric text-[28px] font-semibold text-ink leading-none">{c.value}</p>
                <div className="mt-2">
                  {c.delta ? (
                    <DeltaPill value={c.delta} periodLabel={periodLabel} />
                  ) : (
                    <p className="text-[12px] text-ink-tertiary">{c.sub}</p>
                  )}
                </div>
                {c.delta ? <p className="text-[12px] text-ink-tertiary mt-1">{c.sub}</p> : null}
              </div>
              <div
                className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center shrink-0",
                  c.alert ? "bg-accent text-white" : "bg-accent/10 text-accent",
                )}
              >
                <c.icon className="w-[18px] h-[18px]" />
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard
            title="Invoiced vs collected"
            subtitle="Last 12 months. Collection is booked in the month payment landed, not the month the invoice was raised."
          >
            <div className="h-[260px] w-full">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[13px] text-ink-tertiary">
                    Loading chart…
                  </div>
                }
              >
                <RevenueTrendChart data={trend} formatValue={(v) => formatMoney(v)} />
              </Suspense>
            </div>
          </ChartCard>
        </div>

        <ChartCard
          title="Conversion"
          subtitle="Quotations that reached an order, and decided opportunities that were won."
        >
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-secondary">Quotation → order</span>
                <span className="renso-metric text-[22px] font-semibold text-ink">
                  {conversion.ratePct == null ? "—" : `${conversion.ratePct}%`}
                </span>
              </div>
              <div className="mt-2">
                <ProportionBar share={(conversion.ratePct ?? 0) / 100} />
              </div>
              <p className="mt-1.5 text-[12px] text-ink-tertiary">
                {conversion.converted} of {conversion.sent} quotations sent. Drafts excluded.
              </p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-ink-secondary">Win rate</span>
                <span className="renso-metric text-[22px] font-semibold text-ink">
                  {rate.ratePct == null ? "—" : `${rate.ratePct}%`}
                </span>
              </div>
              <div className="mt-2">
                <ProportionBar share={(rate.ratePct ?? 0) / 100} />
              </div>
              <p className="mt-1.5 text-[12px] text-ink-tertiary">
                {rate.ratePct == null
                  ? "Nothing closed yet — no rate can be calculated."
                  : `${rate.won} won · ${rate.lost} lost`}
              </p>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChartCard title="Open pipeline by stage" subtitle="Value of live opportunities at each stage.">
            {stages.every((s) => s.count === 0) ? (
              <p className="py-8 text-center text-[13px] text-ink-secondary">
                No live opportunities. Add one to populate the funnel.
              </p>
            ) : (
              <div className="space-y-3">
                {stages.map((s) => (
                  <button
                    key={s.stage}
                    type="button"
                    onClick={() => onNavigate("opportunities")}
                    className="block w-full text-left"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-medium text-ink">{s.label}</span>
                      <span className="text-[13px] tabular-nums text-ink-secondary">
                        {s.count} · {formatMoney(s.value)}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ProportionBar share={s.value / stagePeak} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ChartCard>
        </div>

        <ChartCard
          title="Revenue split"
          subtitle="Lifetime revenue per group."
          action={
            <div className="w-[170px]">
              <SegmentedControl
                value={breakdown}
                onChange={(v) => setBreakdown(v as "territory" | "manager")}
                options={[
                  { id: "territory", label: "Territory" },
                  { id: "manager", label: "Manager" },
                ]}
              />
            </div>
          }
        >
          <div className="space-y-3">
            {splits.slice(0, 6).map((sp) => (
              <div key={sp.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink truncate">{sp.label}</span>
                  <span className="text-[13px] tabular-nums text-ink-secondary shrink-0">
                    {formatMoney(sp.revenue)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <ProportionBar share={splitTotal ? sp.revenue / splitTotal : 0} />
                </div>
                <p className="mt-1 text-[11px] text-ink-tertiary">
                  {sp.customers} account{sp.customers === 1 ? "" : "s"}
                </p>
              </div>
            ))}
            {splits.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-ink-secondary">No customers yet.</p>
            ) : null}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Receivables aging" subtitle="Outstanding balances by days past due.">
          <div className="space-y-3">
            {aging.map((bucket) => (
              <button
                key={bucket.label}
                type="button"
                onClick={() => onNavigate("invoices")}
                className="block w-full text-left"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-[13px] font-medium", bucket.label === "Current" ? "text-ink" : "text-accent")}>
                    {bucket.label}
                  </span>
                  <span className="text-[13px] tabular-nums text-ink-secondary">
                    {bucket.count} · {formatMoney(bucket.amount)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <ProportionBar share={agingTotal ? bucket.amount / agingTotal : 0} />
                </div>
              </button>
            ))}
            {agingTotal === 0 ? (
              <p className="pt-2 text-[12px] text-ink-tertiary">Nothing outstanding — every invoice is settled.</p>
            ) : null}
          </div>
        </ChartCard>

        <div className="xl:col-span-2 brand-card overflow-hidden">
          <div className="px-5 py-4 border-b border-divider flex items-center justify-between">
            <h2 className="font-semibold text-sm">Recent pricing activity</h2>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("pricing")}>
              View all
            </Button>
          </div>
          <div className="divide-y divide-divider">
            {metrics.recentPricingChanges.slice(0, 4).map((p) => (
              <div key={p.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center shrink-0">
                  {p.status === "pending_review" ? (
                    <Clock className="w-4 h-4 text-accent" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-[rgb(var(--success))]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.productName}</p>
                  <p className="text-xs text-ink-secondary truncate">
                    {p.supplierName} · {p.unitPrice} {p.currency}
                    {p.quantity ? ` × ${p.quantity}` : ""}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
            {metrics.recentPricingChanges.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-ink-secondary">
                No recent pricing activity
              </div>
            )}
          </div>
        </div>
      </div>

      <ChartCard
        title="Ecosystem activity"
        subtitle="The latest movement across quotations, orders, invoices, documents and KYC — one feed for the whole platform."
      >
        {activity.length ? (
          <div className="divide-y divide-divider -mx-5">
            {activity.map((e) => {
              const Icon = e.icon;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onNavigate(e.section)}
                  className="flex w-full items-center gap-3.5 px-5 py-3 text-left transition-colors hover:bg-elevated"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{e.label}</p>
                    <p className="truncate text-[12px] text-ink-tertiary">{e.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-tertiary tabular-nums">
                    {relativeDay(e.at)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-[13px] text-ink-secondary">
            No activity yet — quotations, orders, invoices, documents and KYC changes will appear here.
          </p>
        )}
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="brand-card p-5">
          <h3 className="text-[15px] font-semibold text-ink mb-3">Pipeline</h3>
          <div className="space-y-2.5">
            <Row label="Pending KYC" value={metrics.pendingKyc} onClick={() => onNavigate("kyc")} />
            <Row label="Active requirements" value={metrics.activeRequirements} onClick={() => onNavigate("requirements")} />
            <Row label="Follow-ups due" value={metrics.followUpsDue} onClick={() => onNavigate("quotations")} />
          </div>
        </div>
        <div className="brand-card p-5">
          <h3 className="text-[15px] font-semibold text-ink mb-3">Top customers</h3>
          <div className="space-y-2">
            {metrics.topCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpenCustomer(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg text-sm px-1.5 py-1 -mx-1.5 hover:bg-elevated transition-colors text-left"
              >
                <span className="truncate text-ink">{c.name}</span>
                <span className="font-medium tabular-nums text-ink shrink-0">{formatMoney(c.revenue)}</span>
              </button>
            ))}
            {metrics.topCustomers.length === 0 && (
              <p className="text-sm text-ink-secondary py-1">No customer revenue yet</p>
            )}
          </div>
        </div>
        <div className="brand-card p-5">
          <h3 className="text-[15px] font-semibold text-ink mb-3">Top suppliers by spend</h3>
          <div className="space-y-2">
            {metrics.topSuppliers.map((sp) => (
              <div key={sp.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-ink">{sp.name}</span>
                <span className="font-medium tabular-nums text-ink shrink-0">{formatMoney(sp.spend)}</span>
              </div>
            ))}
            {metrics.topSuppliers.length === 0 && (
              <p className="text-sm text-ink-secondary py-1">No supplier spend recorded</p>
            )}
          </div>
        </div>
      </div>

      {/* Requirement 8's remaining asks: product sales and profitability, the
          route from revenue to net profit, communication activity, and the
          measured reliability behind requirement 9's scoring. Tabbed rather
          than stacked — four more panels in a column turns the dashboard into
          a document nobody scrolls to the end of. */}
      <div className="space-y-4">
        <SegmentedControl
          value={insight}
          onChange={(next) => setInsight(next as typeof insight)}
          options={[
            { id: "products", label: "Products" },
            { id: "profit", label: "Profit" },
            { id: "comms", label: "Communication" },
            { id: "reliability", label: "Reliability" },
          ]}
        />

        {insight === "products" ? (
          <ProductProfitabilityPanel
            windowDays={periodOption.days ?? 365}
            onOpenRecord={onOpenRecord}
          />
        ) : null}
        {insight === "profit" ? (
          <ProfitWaterfallPanel windowDays={periodOption.days ?? 365} />
        ) : null}
        {insight === "comms" ? <CommsActivityPanel onOpenRecord={onOpenRecord} /> : null}
        {insight === "reliability" ? <ReliabilityPanel onOpenRecord={onOpenRecord} /> : null}
      </div>

      <p className="text-[12px] leading-relaxed text-ink-tertiary">
        Figures are calculated from CRM records in the browser. Amounts in other currencies are
        converted at the rate table in Settings and reported in {store.fx.base}; anything with no
        rate set is reported in its own currency rather than assumed to be at parity. Gross margin
        is measured from approved supplier offers at line level — the Deal Desk shows the cost
        basis behind every figure.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between text-sm hover:opacity-80"
    >
      <span className="text-ink-secondary">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </button>
  );
}

/** Section card used to group related fields inside a data-entry form. */
function FormSection({
  title,
  description,
  children,
  cols = 2,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  cols?: 1 | 2;
}) {
  return (
    <div className="brand-card p-5 sm:p-6 space-y-4">
      <div>
        <div className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{title}</div>
        {description ? <p className="mt-0.5 text-[12px] text-ink-tertiary">{description}</p> : null}
      </div>
      <div className={cn("grid gap-4", cols === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>{children}</div>
    </div>
  );
}

/** A single labeled input/select/textarea field for use inside FormSection. */
function Field({
  label,
  required,
  hint,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", full && "sm:col-span-2")}>
      <label className="flex items-baseline gap-1 text-[13px] font-medium text-ink-secondary">
        {label}
        {required ? <span className="text-accent">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-ink-tertiary">{hint}</p> : null}
    </div>
  );
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, "h-11", props.className)} />;
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, "h-11 appearance-none")}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      rows={props.rows ?? 3}
      className={cn(
        "w-full rounded-control border border-divider bg-canvas px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-tertiary outline-none focus:border-accent resize-none",
        props.className,
      )}
    />
  );
}

const CUSTOMER_STATUS_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "blocked", label: "Blocked" },
];
const CUSTOMER_SEGMENT_OPTIONS = [
  { value: "wholesale", label: "Wholesale" },
  { value: "retail", label: "Retail" },
  { value: "distributor", label: "Distributor" },
  { value: "end_user", label: "End user" },
  { value: "other", label: "Other" },
];
const SUPPLIER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "preferred", label: "Preferred" },
  { value: "inactive", label: "Inactive" },
  { value: "blocked", label: "Blocked" },
];
const KYC_STATUS_OPTIONS = [
  { value: "none", label: "Not started" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];
const CURRENCY_OPTIONS = [
  { value: "GBP", label: "GBP — Pound sterling" },
  { value: "USD", label: "USD — US dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "AED", label: "AED — UAE dirham" },
  { value: "CNY", label: "CNY — Chinese yuan" },
];
const PAYMENT_TERMS_OPTIONS = [
  { value: "", label: "Select payment terms" },
  { value: "100% advance", label: "100% advance" },
  { value: "50% advance / 50% on delivery", label: "50% advance / 50% on delivery" },
  { value: "Net 7", label: "Net 7" },
  { value: "Net 14", label: "Net 14" },
  { value: "Net 30", label: "Net 30" },
  { value: "Net 60", label: "Net 60" },
  { value: "Letter of credit", label: "Letter of credit" },
];

function EntityList({
  title,
  items,
  type,
  initialDetailId,
  onCreateQuotationFor,
}: {
  title: string;
  items: (Customer | Supplier)[];
  type: "customer" | "supplier";
  initialDetailId?: string | null;
  /** Routes "New quotation" shortcuts to the real quotation-builder form
   *  (with this customer prefilled) instead of silently creating an empty,
   *  zero-value stub quotation. Customer-only — suppliers don't quote. */
  onCreateQuotationFor?: (customerId: string) => void;
}) {
  const store = useStore();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "add" | "edit" | "detail">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "commercial" | "documents" | "activity">("overview");
  const [managerFilter, setManagerFilter] = useState("all");
  const [territoryFilter, setTerritoryFilter] = useState("all");

  const emptyCustomerForm = {
    name: "", tradingName: "", status: "lead", segment: "wholesale",
    email: "", phone: "", website: "",
    addressLine1: "", addressLine2: "", city: "", postcode: "", country: "United Kingdom",
    vatNumber: "", companyNumber: "", paymentTerms: "", creditLimit: "", currency: "GBP",
    kycStatus: "none", tags: "", notes: "",
    ownerId: "", territory: "",
  };
  const emptySupplierForm = {
    name: "", tradingName: "", status: "active",
    email: "", phone: "", website: "",
    addressLine1: "", city: "", postcode: "", country: "United Kingdom",
    vatNumber: "", paymentTerms: "", currency: "GBP", tags: "", notes: "",
    ownerId: "",
  };
  const [form, setForm] = useState<Record<string, string>>(type === "customer" ? emptyCustomerForm : emptySupplierForm);
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const matchesQuery = (i: Customer | Supplier) =>
    !q ||
    (i.name || "").toLowerCase().includes(q.toLowerCase()) ||
    (i.tradingName || "").toLowerCase().includes(q.toLowerCase()) ||
    (i.email || "").toLowerCase().includes(q.toLowerCase());

  const matchesManager = (i: Customer | Supplier) => {
    if (managerFilter === "all") return true;
    if (managerFilter === "mine") return i.ownerId === store.user?.id;
    if (managerFilter === "unassigned") return !i.ownerId;
    return i.ownerId === managerFilter;
  };

  const matchesTerritory = (i: Customer | Supplier) => {
    if (type !== "customer" || territoryFilter === "all") return true;
    if (territoryFilter === "unassigned") return !(i as Customer).territory;
    return (i as Customer).territory === territoryFilter;
  };

  const filtered = items.filter((i) => matchesQuery(i) && matchesManager(i) && matchesTerritory(i));
  const filtersActive = managerFilter !== "all" || territoryFilter !== "all";

  const openAdd = () => {
    setForm(type === "customer" ? emptyCustomerForm : emptySupplierForm);
    setEditId(null);
    setMode("add");
  };

  const openEdit = (row: Customer | Supplier) => {
    setEditId(row.id);
    const base = type === "customer" ? emptyCustomerForm : emptySupplierForm;
    const next: Record<string, string> = { ...base };
    for (const k of Object.keys(base)) {
      const v = (row as unknown as Record<string, unknown>)[k];
      if (k === "tags") next.tags = Array.isArray((row as Customer).tags) ? (row as Customer).tags.join(", ") : "";
      else if (v != null) next[k] = String(v);
    }
    setForm(next);
    setMode("edit");
  };

  const openDetail = (row: Customer | Supplier) => {
    setDetailId(row.id);
    setTab("overview");
    setMode("detail");
  };

  // Opens straight to a specific record's detail view when the caller (e.g. the
  // Dashboard "Top customers" list) navigates here with a target id already known.
  // Runs once per mount, matching EntityList's own remount-per-navigation lifecycle.
  useEffect(() => {
    if (!initialDetailId) return;
    const row = items.find((i) => i.id === initialDetailId);
    if (row) openDetail(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDetailId]);

  const save = () => {
    if (!form.name.trim()) return;
    const tags = form.tags
      ? form.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    if (type === "customer") {
      const payload: Partial<Customer> = {
        name: form.name.trim(),
        tradingName: form.tradingName || undefined,
        status: form.status as Customer["status"],
        segment: form.segment as Customer["segment"],
        email: form.email || undefined,
        phone: form.phone || undefined,
        website: form.website || undefined,
        addressLine1: form.addressLine1 || undefined,
        addressLine2: form.addressLine2 || undefined,
        city: form.city || undefined,
        postcode: form.postcode || undefined,
        country: form.country || "United Kingdom",
        vatNumber: form.vatNumber || undefined,
        companyNumber: form.companyNumber || undefined,
        paymentTerms: form.paymentTerms || undefined,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
        currency: form.currency || "GBP",
        kycStatus: form.kycStatus as Customer["kycStatus"],
        ownerId: form.ownerId || undefined,
        territory: form.territory || undefined,
        tags,
        notes: form.notes || undefined,
      };
      if (mode === "add") store.addCustomer(payload);
      else if (editId) store.updateCustomer(editId, payload);
    } else {
      const payload: Partial<Supplier> = {
        name: form.name.trim(),
        tradingName: form.tradingName || undefined,
        status: form.status as Supplier["status"],
        email: form.email || undefined,
        phone: form.phone || undefined,
        website: form.website || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        postcode: form.postcode || undefined,
        country: form.country || "United Kingdom",
        vatNumber: form.vatNumber || undefined,
        paymentTerms: form.paymentTerms || undefined,
        currency: form.currency || "GBP",
        ownerId: form.ownerId || undefined,
        tags,
        notes: form.notes || undefined,
      };
      if (mode === "add") store.addSupplier(payload);
      else if (editId) store.updateSupplier(editId, payload);
    }
    setMode(mode === "add" ? "list" : "detail");
  };

  const remove = (id: string, label: string) => {
    if (!window.confirm(`Remove ${label}?`)) return;
    if (type === "customer") store.removeCustomer(id);
    else store.removeSupplier(id);
    setMode("list");
  };

  if (mode === "detail" && detailId) {
    const row = items.find((i) => i.id === detailId) || store.customers.find((c) => c.id === detailId) || store.suppliers.find((s) => s.id === detailId);
    if (!row) {
      setMode("list");
      return null;
    }
    const quotes = store.quotations.filter((x) => x.customerId === detailId);
    const orders = store.orders.filter((x) => x.customerId === detailId);
    const invoices = store.invoices.filter((x) => x.customerId === detailId);
    const docs = store.documents.filter((x) => x.customerId === detailId || x.supplierId === detailId);
    const opps = store.opportunities.filter((x) => x.customerId === detailId);
    const prices = store.pricingRecords.filter((x) => x.supplierId === detailId);
    const pendingForSupplier = prices.filter((p) => p.status === "pending_review");
    const marketPositions = type === "supplier" ? supplierMarketPositions(detailId, store.pricingRecords) : [];
    const livePriceScore = type === "supplier" ? livePriceCompetitiveness(detailId, store.pricingRecords) : null;
    const score = row.relationshipScore ?? (type === "customer" ? 72 : 68);
    const revenue = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.total || 0), 0)
      || (row as Customer).totalRevenue || 0;
    const outstanding = invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + (i.total || 0), 0);

    return (
      <div className="space-y-6 animate-rise">
        <BackLink label={title} onClick={() => setMode("list")} />

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[28px] font-bold tracking-tight text-ink">{row.name}</h1>
              {row.status ? <StatusBadge status={row.status} /> : null}
            </div>
            <p className="text-[14px] text-ink-secondary mt-1">
              {row.country || "—"}
              {row.tradingName ? ` · ${row.tradingName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {type === "customer" ? (
              <>
                <Button type="button" onClick={() => onCreateQuotationFor?.(detailId)}>
                  New quotation
                </Button>
                <Button type="button" variant="secondary" onClick={() => openEdit(row)}>
                  Edit
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" onClick={() => openEdit(row)}>
                Edit
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => remove(detailId, row.name)}>
              Remove
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Relationship score", value: String(score) },
            { label: type === "customer" ? "Revenue" : "Spend", value: formatMoney(type === "customer" ? revenue : ((row as Supplier).totalSpend || prices.reduce((s, p) => s + (p.unitPrice || 0) * (p.quantity || 1), 0)), row.currency || "GBP") },
            { label: type === "customer" ? "Outstanding" : "Price records", value: type === "customer" ? formatMoney(outstanding, "GBP") : String(prices.length) },
            { label: type === "customer" ? "Quotations" : "Products linked", value: type === "customer" ? String(quotes.length) : String(new Set(prices.map((p) => p.productName)).size) },
          ].map((k) => (
            <div key={k.label} className="brand-card p-4">
              <div className="text-[12px] text-ink-secondary">{k.label}</div>
              <div className="renso-metric mt-1.5 text-[22px] font-semibold tracking-tight text-ink">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-divider overflow-x-auto">
          {(["overview", "commercial", "documents", "activity"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "px-4 py-2.5 text-[13px] font-semibold capitalize border-b-2 -mb-px transition-colors whitespace-nowrap",
                tab === id ? "border-[rgb(var(--accent-deep))] text-ink" : "border-transparent text-ink-secondary hover:text-ink",
              )}
            >
              {id === "commercial" ? (type === "supplier" ? "Pricing & Intelligence" : "Pipeline") : id}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="brand-card p-5 space-y-3">
              <div className="text-[15px] font-semibold text-ink">Profile</div>
              <div className="space-y-2 text-[14px]">
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Legal name</span><span className="font-medium text-ink text-right">{row.name}</span></div>
                {row.tradingName ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Trading name</span><span className="text-ink text-right">{row.tradingName}</span></div> : null}
                {type === "customer" && (row as Customer).segment ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Segment</span><span className="text-ink text-right capitalize">{(row as Customer).segment.replace("_", " ")}</span></div> : null}
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Status</span><span className="text-ink text-right capitalize">{row.status || "active"}</span></div>
                {row.email ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Email</span><span className="text-ink text-right truncate">{row.email}</span></div> : null}
                {row.phone ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Phone</span><span className="text-ink text-right">{row.phone}</span></div> : null}
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Address</span><span className="text-ink text-right">{[row.addressLine1, row.city, row.postcode].filter(Boolean).join(", ") || "—"}</span></div>
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Country</span><span className="text-ink text-right">{row.country || "—"}</span></div>
                {row.vatNumber ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">VAT number</span><span className="text-ink text-right font-mono">{row.vatNumber}</span></div> : null}
                {row.paymentTerms ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Payment terms</span><span className="text-ink text-right">{row.paymentTerms}</span></div> : null}
                {type === "customer" && (row as Customer).creditLimit ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Credit limit</span><span className="text-ink text-right">{formatMoney((row as Customer).creditLimit || 0, row.currency)}</span></div> : null}
                {type === "customer" ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">KYC status</span><span className="text-ink text-right capitalize">{(row as Customer).kycStatus || "none"}</span></div> : null}
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Relationship manager</span><span className="text-ink text-right">{store.users.find((u) => u.id === row.ownerId)?.name || "Unassigned"}</span></div>
                {type === "customer" ? <div className="flex justify-between gap-4"><span className="text-ink-secondary">Sales territory</span><span className="text-ink text-right">{(row as Customer).territory || "Unassigned"}</span></div> : null}
                <div className="flex justify-between gap-4"><span className="text-ink-secondary">Score</span><span className="font-semibold text-ink text-right">{score}/100</span></div>
                {row.tags && row.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {row.tags.map((t) => (
                      <span key={t} className="rounded-full bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary">{t}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              {row.notes ? (
                <p className="text-[13px] text-ink-secondary pt-2 border-t border-divider leading-relaxed">{row.notes}</p>
              ) : null}
              <p className="text-[12px] text-ink-tertiary pt-2 border-t border-divider">
                Score factors: revenue, order frequency, payment reliability, recency{type === "supplier" ? ", price competitiveness, delivery" : ""}.
              </p>
            </div>
            <div className="brand-card p-5 space-y-3">
              <div className="text-[15px] font-semibold text-ink">Quick actions</div>
              <div className="grid grid-cols-2 gap-2">
                {type === "customer" ? (
                  <>
                    <button type="button" onClick={() => onCreateQuotationFor?.(detailId)} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">New quotation</button>
                    <button type="button" onClick={() => setTab("documents")} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">Documents</button>
                    <button type="button" onClick={() => setTab("commercial")} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">Pipeline</button>
                    <button type="button" onClick={() => setTab("activity")} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">Activity</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setTab("commercial")} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">Pricing</button>
                    <button type="button" onClick={() => setTab("documents")} className="rounded-xl bg-[rgb(var(--surface-elevated))] px-3 py-3 text-[13px] font-medium text-ink text-left transition-[background-color,transform] duration-150 ease-out hover:bg-[rgb(var(--divider))] active:scale-[0.98]">Documents</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "commercial" && type === "customer" && (
          <div className="space-y-4">
            <div className="brand-card overflow-hidden divide-y divide-divider">
              <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Quotations · {quotes.length}</div>
              {quotes.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No quotations yet.</div> : quotes.map((q) => (
                <div key={q.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold">{q.number}</div>
                    <div className="text-[12px] text-ink-secondary">{formatMoney(q.total, q.currency)} · {q.notes || "Quotation"}</div>
                  </div>
                  <StatusBadge status={q.status} />
                </div>
              ))}
            </div>
            <div className="brand-card overflow-hidden divide-y divide-divider">
              <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Orders · {orders.length}</div>
              {orders.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No orders yet.</div> : orders.map((o) => (
                <div key={o.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold">{o.number}</div>
                    <div className="text-[12px] text-ink-secondary">{formatMoney(o.total, o.currency)}</div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
              ))}
            </div>
            <div className="brand-card overflow-hidden divide-y divide-divider">
              <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Invoices · {invoices.length}</div>
              {invoices.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">No invoices yet.</div> : invoices.map((inv) => (
                <div key={inv.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold font-mono">{inv.number}</div>
                    <div className="text-[12px] text-ink-secondary">{formatMoney(inv.total, inv.currency)}</div>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
              ))}
            </div>
            {opps.length > 0 ? (
              <div className="brand-card overflow-hidden divide-y divide-divider">
                <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Opportunities · {opps.length}</div>
                {opps.map((o) => (
                  <div key={o.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 text-[14px] font-medium">{o.title}</div>
                    <StatusBadge status={o.stage} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {tab === "commercial" && type === "supplier" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="brand-card p-4">
                <div className="text-[12px] text-ink-secondary">Price competitiveness</div>
                <div className="renso-metric mt-1.5 text-[22px] font-semibold text-ink">
                  {livePriceScore != null
                    ? `${livePriceScore}/100`
                    : (row as Supplier).priceCompetitiveness != null
                      ? `${(row as Supplier).priceCompetitiveness}/100`
                      : "—"}
                </div>
                <div className="text-[11px] text-ink-tertiary mt-0.5">
                  {livePriceScore != null ? "Live · vs other suppliers" : "Estimated"}
                </div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[12px] text-ink-secondary">Delivery performance</div>
                <div className="renso-metric mt-1.5 text-[22px] font-semibold text-ink">
                  {(row as Supplier).deliveryPerformance != null ? `${(row as Supplier).deliveryPerformance}/100` : "—"}
                </div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[12px] text-ink-secondary">Products compared</div>
                <div className="renso-metric mt-1.5 text-[22px] font-semibold text-ink">{marketPositions.length}</div>
              </div>
              <div className="brand-card p-4">
                <div className="text-[12px] text-ink-secondary">Last offer</div>
                <div className="renso-metric mt-1.5 text-[16px] font-semibold text-ink">
                  {prices.length > 0
                    ? new Date(
                        prices.slice().sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))[0].extractedAt,
                      ).toLocaleDateString("en-GB")
                    : "—"}
                </div>
              </div>
            </div>

            {pendingForSupplier.length > 0 ? (
              <div>
                <div className="mb-2 text-[13px] font-semibold text-ink-secondary">
                  Awaiting review · {pendingForSupplier.length}
                </div>
                <div className="space-y-3">
                  {pendingForSupplier.map((r) => (
                    <PricingReviewCard key={r.id} record={r} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="brand-card overflow-hidden divide-y divide-divider">
              <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Market position by product</div>
              {marketPositions.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-ink-secondary">
                  No cross-supplier comparison yet — needs approved pricing from at least two suppliers on the same
                  product, in the same currency.
                </div>
              ) : (
                marketPositions.map((p) => (
                  <div key={p.productName} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold truncate">{p.productName}</div>
                      <div className="text-[12px] text-ink-secondary">
                        {formatMoney(p.unitPrice, p.currency)} · market {formatMoney(p.marketMin, p.currency)}–
                        {formatMoney(p.marketMax, p.currency)} · {p.totalSuppliers} supplier
                        {p.totalSuppliers === 1 ? "" : "s"} compared
                      </div>
                    </div>
                    <div
                      className={cn(
                        "flex items-center gap-1 text-[13px] font-semibold shrink-0",
                        p.rank === 1 ? "text-[rgb(var(--success))]" : p.percentAboveMin > 10 ? "text-accent" : "text-ink-secondary",
                      )}
                    >
                      {p.rank === 1 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                      {p.rank === 1 ? "Cheapest" : `#${p.rank} of ${p.totalSuppliers}`}
                      {p.percentAboveMin > 0 ? ` · +${p.percentAboveMin}%` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="brand-card overflow-hidden divide-y divide-divider">
              <div className="px-4 py-3 text-[13px] font-semibold text-ink-secondary">Pricing history · {prices.length}</div>
              {prices.length === 0 ? (
                <div className="px-4 py-10 text-center text-[13px] text-ink-secondary">No pricing records for this supplier.</div>
              ) : (
                prices
                  .slice()
                  .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
                  .map((pr) => (
                    <div key={pr.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold truncate">{pr.productName}</div>
                        <div className="text-[12px] text-ink-secondary">
                          {formatMoney(pr.unitPrice, pr.currency)} · qty {pr.quantity ?? "—"} · {pr.source} ·{" "}
                          {new Date(pr.extractedAt).toLocaleDateString("en-GB")}
                        </div>
                      </div>
                      <StatusBadge status={pr.status} />
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {tab === "documents" && (
          <div className="brand-card overflow-hidden divide-y divide-divider">
            {docs.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-ink-secondary">
                No documents linked. Upload contracts, KYC, certificates from Documents.
              </div>
            ) : (
              docs
                .slice()
                .sort((a, b) => {
                  // Anything lapsing floats to the top of the account's file.
                  const order: Record<ExpiryState, number> = { expired: 0, expiring: 1, valid: 2, none: 3 };
                  const ea = documentExpiry(a, store.crmSettings.documentExpiryWarningDays);
                  const eb = documentExpiry(b, store.crmSettings.documentExpiryWarningDays);
                  return order[ea.state] - order[eb.state];
                })
                .map((d) => (
                  <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold truncate">{d.name}</div>
                      <div className="text-[12px] text-ink-secondary capitalize">
                        {d.type}
                        {d.reference ? ` · ${d.reference}` : ""}
                        {d.expiresAt ? ` · expires ${shortDate(d.expiresAt)}` : ""}
                      </div>
                    </div>
                    <ExpiryBadge info={documentExpiry(d, store.crmSettings.documentExpiryWarningDays)} />
                  </div>
                ))
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="brand-card p-5">
            <div className="space-y-4">
              {[
                { t: "Record created", d: row.createdAt },
                ...quotes.slice(0, 3).map((q) => ({ t: `Quotation ${q.number} · ${q.status}`, d: q.updatedAt || q.createdAt })),
                ...invoices.slice(0, 3).map((inv) => ({ t: `Invoice ${inv.number} · ${inv.status}`, d: inv.updatedAt || inv.createdAt })),
                ...prices.slice(0, 3).map((pr) => ({ t: `Pricing · ${pr.productName}`, d: pr.extractedAt })),
              ]
                .filter((x) => x.d)
                .sort((a, b) => String(b.d).localeCompare(String(a.d)))
                .slice(0, 12)
                .map((ev, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 rounded-full bg-[rgb(var(--accent))] shrink-0" />
                    <div>
                      <div className="text-[14px] font-medium text-ink">{ev.t}</div>
                      <div className="text-[12px] text-ink-tertiary">
                        {ev.d ? new Date(ev.d).toLocaleString("en-GB") : ""}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "add" || mode === "edit") {
    const isCustomer = type === "customer";
    return (
      <div className="max-w-3xl space-y-6 pb-24">
        <BackLink
          label={`Back to ${editId ? form.name || title : title}`}
          onClick={() => setMode(editId ? "detail" : "list")}
        />
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">
            {mode === "add" ? `Add ${isCustomer ? "customer" : "supplier"}` : `Edit ${isCustomer ? "customer" : "supplier"}`}
          </h1>
          <p className="mt-1 text-[14px] text-ink-secondary">
            {isCustomer
              ? "Set up the account so Sales, Finance and Operations all work from the same record."
              : "Capture commercial terms up front so pricing intelligence and procurement stay accurate."}
          </p>
        </div>

        <FormSection title="Identity" description="Legal identity and how this account is classified.">
          <Field label="Legal name" required full>
            <TextInput value={form.name} onChange={(e) => setF("name", e.target.value)} placeholder="Legal / trading name" autoFocus />
          </Field>
          <Field label="Trading name" hint="Optional — if different from legal name">
            <TextInput value={form.tradingName} onChange={(e) => setF("tradingName", e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Status">
            <SelectInput value={form.status} onChange={(v) => setF("status", v)} options={isCustomer ? CUSTOMER_STATUS_OPTIONS : SUPPLIER_STATUS_OPTIONS} />
          </Field>
          {isCustomer ? (
            <Field label="Segment">
              <SelectInput value={form.segment} onChange={(v) => setF("segment", v)} options={CUSTOMER_SEGMENT_OPTIONS} />
            </Field>
          ) : null}
          <Field label="Company registration number">
            <TextInput value={isCustomer ? form.companyNumber : ""} onChange={(e) => setF("companyNumber", e.target.value)} placeholder="e.g. 04582917" disabled={!isCustomer} />
          </Field>
          <Field label="VAT number">
            <TextInput value={form.vatNumber} onChange={(e) => setF("vatNumber", e.target.value)} placeholder="GB123456789" />
          </Field>
        </FormSection>

        <FormSection title="Contact" description="Primary channels for day-to-day communication.">
          <Field label="Email">
            <TextInput type="email" value={form.email} onChange={(e) => setF("email", e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="Phone">
            <TextInput type="tel" value={form.phone} onChange={(e) => setF("phone", e.target.value)} placeholder="+44…" />
          </Field>
          <Field label="Website" full>
            <TextInput value={form.website} onChange={(e) => setF("website", e.target.value)} placeholder="https://…" />
          </Field>
        </FormSection>

        <FormSection title="Address" description="Used for correspondence, contracts and shipping documents.">
          <Field label="Address line 1" full>
            <TextInput value={form.addressLine1} onChange={(e) => setF("addressLine1", e.target.value)} placeholder="Street address" />
          </Field>
          {isCustomer ? (
            <Field label="Address line 2" full>
              <TextInput value={form.addressLine2} onChange={(e) => setF("addressLine2", e.target.value)} placeholder="Optional" />
            </Field>
          ) : null}
          <Field label="City">
            <TextInput value={form.city} onChange={(e) => setF("city", e.target.value)} />
          </Field>
          <Field label="Postcode">
            <TextInput value={form.postcode} onChange={(e) => setF("postcode", e.target.value)} />
          </Field>
          <Field label="Country" full>
            <TextInput value={form.country} onChange={(e) => setF("country", e.target.value)} />
          </Field>
        </FormSection>

        <FormSection title="Commercial terms" description="Drives pricing, invoicing and credit control for this account.">
          <Field label="Currency">
            <SelectInput value={form.currency} onChange={(v) => setF("currency", v)} options={CURRENCY_OPTIONS} />
          </Field>
          <Field label="Payment terms">
            <SelectInput value={form.paymentTerms} onChange={(v) => setF("paymentTerms", v)} options={PAYMENT_TERMS_OPTIONS} />
          </Field>
          {isCustomer ? (
            <Field label="Credit limit" hint="Maximum outstanding balance before orders are held">
              <TextInput type="number" min="0" value={form.creditLimit} onChange={(e) => setF("creditLimit", e.target.value)} placeholder="0" />
            </Field>
          ) : null}
          {isCustomer ? (
            <Field label="KYC status">
              <SelectInput value={form.kycStatus} onChange={(v) => setF("kycStatus", v)} options={KYC_STATUS_OPTIONS} />
            </Field>
          ) : null}
        </FormSection>

        <FormSection
          title="Ownership"
          description={
            isCustomer
              ? "Who owns this relationship, and which territory it reports under."
              : "Who owns this supplier relationship day to day."
          }
        >
          <Field label="Relationship manager" hint="Shown on the account and used to filter your book">
            <SelectInput
              value={form.ownerId}
              onChange={(v) => setF("ownerId", v)}
              options={[
                { value: "", label: "Unassigned" },
                ...store.users.map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABELS[u.role]}` })),
              ]}
            />
          </Field>
          {isCustomer ? (
            <Field label="Sales territory" hint="Territories are maintained in Settings → CRM">
              <SelectInput
                value={form.territory}
                onChange={(v) => setF("territory", v)}
                options={[
                  { value: "", label: "Unassigned" },
                  ...store.crmSettings.salesTerritories.map((t) => ({ value: t, label: t })),
                ]}
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title="Notes & tags" cols={1} description="Internal context for anyone else who picks up this account.">
          <Field label="Tags" hint="Comma-separated, e.g. VIP, Ramadan buyer, Freight-sensitive">
            <TextInput value={form.tags} onChange={(e) => setF("tags", e.target.value)} placeholder="Tag one, tag two" />
          </Field>
          <Field label="Internal notes">
            <TextArea value={form.notes} onChange={(e) => setF("notes", e.target.value)} placeholder="Preferences, history, anything the team should know…" rows={4} />
          </Field>
        </FormSection>

        <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 border-t border-divider bg-canvas/95 px-1 py-4 backdrop-blur sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => setMode(editId ? "detail" : "list")}
            className="h-12 rounded-full px-6 text-[15px] font-semibold text-ink-secondary hover:bg-elevated sm:w-auto"
          >
            Cancel
          </button>
          <Button className="h-12 rounded-full bg-accent px-8 text-white font-semibold" onClick={save} disabled={!form.name.trim()}>
            {mode === "add" ? `Save ${isCustomer ? "customer" : "supplier"}` : "Save changes"}
          </Button>
        </div>
      </div>
    );
  }

  // List-level summary — gives Customers and Suppliers their own mini-dashboard
  // above the table instead of dropping straight into a bare list, and the
  // figures differ by type rather than reusing one generic stat set.
  const activeCount = items.filter((i) => i.status === "active").length;
  const unassignedCount = items.filter((i) => !i.ownerId).length;
  const totalValue = items.reduce(
    (sum, i) => sum + ((i as Customer).totalRevenue ?? (i as Supplier).totalSpend ?? 0),
    0,
  );
  const listCurrency = items[0]?.currency || "GBP";
  const listStats = type === "customer"
    ? [
        { label: "Customers", value: String(items.length) },
        { label: "Active", value: String(activeCount) },
        { label: "Lifetime revenue", value: formatMoney(totalValue, listCurrency) },
        { label: "Unassigned", value: String(unassignedCount) },
      ]
    : [
        { label: "Suppliers", value: String(items.length) },
        { label: "Active", value: String(activeCount) },
        { label: "Lifetime spend", value: formatMoney(totalValue, listCurrency) },
        { label: "Unassigned", value: String(unassignedCount) },
      ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            {filtered.length}
            {filtersActive ? ` of ${items.length}` : ""} records
          </p>
        </div>
        <Button className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm" onClick={openAdd}>
          Add {type === "customer" ? "customer" : "supplier"}
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {listStats.map((s) => (
          <div key={s.label} className="brand-card p-4">
            <div className="text-[12px] text-ink-secondary">{s.label}</div>
            <div className="renso-metric mt-1 text-[20px] font-semibold tracking-tight text-ink">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${title.toLowerCase()}…`}
          className="h-11 w-full rounded-xl border-0 bg-surface pl-10 pr-4 text-[15px] shadow-sm ring-1 ring-divider"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Relationship manager">
          <SelectInput
            value={managerFilter}
            onChange={setManagerFilter}
            options={[
              { value: "all", label: "All managers" },
              { value: "mine", label: "My accounts" },
              { value: "unassigned", label: "Unassigned" },
              ...store.users.map((u) => ({ value: u.id, label: u.name })),
            ]}
          />
        </Field>
        {type === "customer" ? (
          <Field label="Sales territory">
            <SelectInput
              value={territoryFilter}
              onChange={setTerritoryFilter}
              options={[
                { value: "all", label: "All territories" },
                { value: "unassigned", label: "Unassigned" },
                ...store.crmSettings.salesTerritories.map((t) => ({ value: t, label: t })),
              ]}
            />
          </Field>
        ) : null}
      </div>
      <div className="brand-card overflow-hidden divide-y divide-divider">
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-[14px] text-ink-secondary">
            {items.length === 0
              ? "No records. Add one to get started."
              : "No records match the current search or filters."}
          </div>
        ) : (
          filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => openDetail(row)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-elevated/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold tracking-tight truncate">{row.name}</div>
                <div className="text-[13px] text-ink-secondary truncate">
                  {(row as Customer).territory || row.country || "—"}
                  {row.ownerId ? ` · ${store.users.find((u) => u.id === row.ownerId)?.name || "Assigned"}` : " · Unassigned"}
                  {row.relationshipScore != null ? ` · Score ${row.relationshipScore}` : ""}
                  {(row as Customer).totalRevenue != null ? ` · ${formatMoney((row as Customer).totalRevenue!, row.currency)}` : ""}
                  {(row as Supplier).totalSpend != null ? ` · Spend ${formatMoney((row as Supplier).totalSpend!, row.currency)}` : ""}
                </div>
              </div>
              {row.status ? <StatusBadge status={row.status} /> : null}
              <ChevronRight className="h-4 w-4 text-ink-tertiary shrink-0" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}


const PRODUCT_CATEGORY_OPTIONS = [
  { value: "", label: "Select category" },
  { value: "Electronics", label: "Electronics" },
  { value: "Industrial parts", label: "Industrial parts" },
  { value: "Textiles", label: "Textiles" },
  { value: "Food & beverage", label: "Food & beverage" },
  { value: "Construction materials", label: "Construction materials" },
  { value: "Automotive", label: "Automotive" },
  { value: "Packaging", label: "Packaging" },
  { value: "Other", label: "Other" },
];
const PRODUCT_UNIT_OPTIONS = [
  { value: "pcs", label: "Pieces (pcs)" },
  { value: "kg", label: "Kilograms (kg)" },
  { value: "tonne", label: "Tonnes" },
  { value: "litre", label: "Litres" },
  { value: "box", label: "Box" },
  { value: "carton", label: "Carton" },
  { value: "pallet", label: "Pallet" },
  { value: "container", label: "Container" },
];

function ProductsPage() {
  const store = useStore();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const emptyProductForm = {
    name: "", sku: "", description: "", category: "", unit: "pcs", packaging: "",
    specifications: "", purchasePrice: "", sellingPrice: "", currency: "GBP",
    tags: "", isActive: true, supplierIds: [] as string[],
  };
  const [pf, setPf] = useState(emptyProductForm);
  const setPF = (k: keyof typeof emptyProductForm, v: string | boolean | string[]) =>
    setPf((f) => ({ ...f, [k]: v }));

  const list = store.products.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      (p.sku || "").toLowerCase().includes(q.toLowerCase()) ||
      (p.category || "").toLowerCase().includes(q.toLowerCase()),
  );

  const margin =
    pf.sellingPrice && pf.purchasePrice && Number(pf.purchasePrice) > 0
      ? (((Number(pf.sellingPrice) - Number(pf.purchasePrice)) / Number(pf.sellingPrice)) * 100).toFixed(1)
      : null;

  const save = () => {
    if (!pf.name.trim()) return;
    store.addProduct({
      name: pf.name.trim(),
      sku: pf.sku.trim() || undefined,
      description: pf.description || undefined,
      category: pf.category || undefined,
      unit: pf.unit || "pcs",
      packaging: pf.packaging || undefined,
      specifications: pf.specifications || undefined,
      purchasePrice: pf.purchasePrice ? Number(pf.purchasePrice) : undefined,
      sellingPrice: pf.sellingPrice ? Number(pf.sellingPrice) : 0,
      currency: pf.currency || "GBP",
      tags: pf.tags ? pf.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      isActive: pf.isActive,
      supplierIds: pf.supplierIds,
    });
    setAdding(false);
    setPf(emptyProductForm);
  };

  if (adding) {
    return (
      <div className="max-w-3xl space-y-6 pb-24">
        <BackLink label="Products" onClick={() => setAdding(false)} />
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">Add product</h1>
          <p className="mt-1 text-[14px] text-ink-secondary">
            Products drive pricing intelligence, supplier comparison and quotations — the more complete the record, the better the match.
          </p>
        </div>

        <FormSection title="Identity" description="How this product is found, ordered and reported on.">
          <Field label="Product name" required full>
            <TextInput value={pf.name} onChange={(e) => setPF("name", e.target.value)} placeholder="e.g. Galvanised steel pipe 20mm" autoFocus />
          </Field>
          <Field label="SKU">
            <TextInput value={pf.sku} onChange={(e) => setPF("sku", e.target.value)} placeholder="Internal SKU" />
          </Field>
          <Field label="Category">
            <SelectInput value={pf.category} onChange={(v) => setPF("category", v)} options={PRODUCT_CATEGORY_OPTIONS} />
          </Field>
          <Field label="Description" full>
            <TextArea value={pf.description} onChange={(e) => setPF("description", e.target.value)} placeholder="What this product is, typical use case…" rows={2} />
          </Field>
        </FormSection>

        <FormSection title="Unit & packaging" description="How this product is measured, packed and shipped.">
          <Field label="Unit of sale">
            <SelectInput value={pf.unit} onChange={(v) => setPF("unit", v)} options={PRODUCT_UNIT_OPTIONS} />
          </Field>
          <Field label="Packaging">
            <TextInput value={pf.packaging} onChange={(e) => setPF("packaging", e.target.value)} placeholder="e.g. 25kg bags, 40ft container" />
          </Field>
          <Field label="Specifications" full hint="Dimensions, grade, standards, tolerances…">
            <TextArea value={pf.specifications} onChange={(e) => setPF("specifications", e.target.value)} placeholder="Technical specification" rows={2} />
          </Field>
        </FormSection>

        <FormSection title="Pricing" description="Cost and selling price used across quotations and margin reporting.">
          <Field label="Currency">
            <SelectInput value={pf.currency} onChange={(v) => setPF("currency", v)} options={CURRENCY_OPTIONS} />
          </Field>
          <Field label="Status">
            <SelectInput
              value={pf.isActive ? "active" : "inactive"}
              onChange={(v) => setPF("isActive", v === "active")}
              options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
            />
          </Field>
          <Field label="Purchase price" hint="Cost price from primary supplier">
            <TextInput type="number" min="0" value={pf.purchasePrice} onChange={(e) => setPF("purchasePrice", e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Selling price">
            <TextInput type="number" min="0" value={pf.sellingPrice} onChange={(e) => setPF("sellingPrice", e.target.value)} placeholder="0.00" />
          </Field>
          {margin ? (
            <div className="sm:col-span-2 rounded-control bg-elevated px-3.5 py-2.5 text-[13px] font-medium text-ink-secondary">
              Estimated margin: <span className="font-semibold text-ink">{margin}%</span>
            </div>
          ) : null}
        </FormSection>

        <FormSection title="Suppliers" cols={1} description="Link every supplier that can fulfil this product for price comparison.">
          {store.suppliers.length === 0 ? (
            <p className="text-[13px] text-ink-tertiary">No suppliers yet — add one from Suppliers, then link it here.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {store.suppliers.map((s) => {
                const checked = pf.supplierIds.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2.5 rounded-control border border-divider px-3 py-2.5 text-[14px] text-ink cursor-pointer hover:bg-elevated">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPF("supplierIds", checked ? pf.supplierIds.filter((id) => id !== s.id) : [...pf.supplierIds, s.id])
                      }
                      className="h-4 w-4 rounded border-divider accent-[rgb(var(--accent))]"
                    />
                    {s.name}
                  </label>
                );
              })}
            </div>
          )}
        </FormSection>

        <FormSection title="Tags" cols={1}>
          <Field label="Tags" hint="Comma-separated, e.g. Fast-moving, Seasonal, High-margin">
            <TextInput value={pf.tags} onChange={(e) => setPF("tags", e.target.value)} placeholder="Tag one, tag two" />
          </Field>
        </FormSection>

        <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 border-t border-divider bg-canvas/95 px-1 py-4 backdrop-blur sm:flex-row sm:justify-end">
          <button type="button" onClick={() => setAdding(false)} className="h-12 rounded-full px-6 text-[15px] font-semibold text-ink-secondary hover:bg-elevated">
            Cancel
          </button>
          <Button className="h-12 rounded-full bg-accent px-8 text-white font-semibold" onClick={save} disabled={!pf.name.trim()}>
            Save product
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Products</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            SKU, prices, suppliers · {list.length} products
          </p>
        </div>
        <Button className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm" onClick={() => setAdding(true)}>
          Add product
        </Button>
      </div>
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products or SKU…"
          className="h-11 w-full rounded-xl bg-surface pl-10 pr-4 text-[15px] shadow-sm ring-1 ring-divider"
        />
      </div>
      <div className="brand-card overflow-hidden divide-y divide-divider">
        {list.map((p) => {
          const offers = store.pricingRecords.filter(
            (r) => r.productName?.toLowerCase().includes(p.name.toLowerCase().slice(0, 12)) || r.productId === p.id,
          );
          return (
            <div key={p.id} className="px-4 py-3.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-[15px] font-semibold">{p.name}</div>
                  {!p.isActive ? <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-semibold text-ink-tertiary">INACTIVE</span> : null}
                </div>
                <div className="text-[13px] text-ink-secondary mt-0.5">
                  {p.sku || "No SKU"} · {p.category || "Uncategorised"} · {p.unit}
                  {p.sellingPrice != null ? ` · Sell ${formatMoney(p.sellingPrice, p.currency)}` : ""}
                  {p.purchasePrice != null ? ` · Buy ${formatMoney(p.purchasePrice, p.currency)}` : ""}
                </div>
                {offers.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {offers.slice(0, 3).map((o) => (
                      <span key={o.id} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-ink-secondary">
                        {o.supplierName}: {formatMoney(o.unitPrice, o.currency)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="text-[13px] font-medium text-ink-secondary"
                onClick={() => {
                  if (window.confirm(`Remove ${p.name}?`)) store.removeProduct(p.id);
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PricingIntelligence() {
  const store = useStore();
  const [filter, setFilter] = useState<"all" | "pending_review" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");
  const pending = store.pricingRecords.filter((r) => r.status === "pending_review");
  const list = store.pricingRecords
    .filter((r) => filter === "all" || r.status === filter)
    .filter(
      (r) =>
        !q ||
        r.productName.toLowerCase().includes(q.toLowerCase()) ||
        r.supplierName.toLowerCase().includes(q.toLowerCase()) ||
        (r.originalText || "").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Pricing &amp; Supplier Offers</h1>
        <p className="text-[14px] text-ink-secondary mt-1">
          Every supplier offer — typed in or lifted from a message by AI extraction — lands here for human review before it becomes commercial pricing data. Nothing is auto-committed.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "All offers", value: store.pricingRecords.length },
          { label: "Pending review", value: pending.length, alert: true },
          { label: "Approved", value: store.pricingRecords.filter((r) => r.status === "approved").length },
          { label: "Rejected", value: store.pricingRecords.filter((r) => r.status === "rejected").length },
        ].map((m) => (
          <div key={m.label} className="brand-card p-4">
            <div className="text-[12px] text-ink-secondary">{m.label}</div>
            <div className={`renso-metric text-[24px] font-semibold mt-1 ${m.alert && m.value ? "text-accent" : ""}`}>
              {m.value}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product, supplier, source text…"
            className="h-11 w-full rounded-xl bg-surface pl-10 pr-4 text-[15px] shadow-sm ring-1 ring-divider"
          />
        </div>
        <div className="flex rounded-full bg-elevated p-1">
          {(["all", "pending_review", "approved", "rejected"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium capitalize ${
                filter === f ? "bg-surface shadow-sm" : "text-ink-secondary"
              }`}
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {list.map((record) => (
          <PricingReviewCard key={record.id} record={record} />
        ))}
        {list.length === 0 ? (
          <div className="brand-card px-5 py-12 text-center text-sm text-ink-secondary">
            No pricing records for this filter.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PricingReviewCard({ record }: { record: PricingRecord }) {
  const store = useStore();
  const isPending = record.status === "pending_review";
  const [editing, setEditing] = useState(false);
  const [productName, setProductName] = useState(record.productName);
  const [supplierName, setSupplierName] = useState(record.supplierName);
  const [unitPrice, setUnitPrice] = useState(String(record.unitPrice));
  const [quantity, setQuantity] = useState(record.quantity == null ? "" : String(record.quantity));
  const [deliveryInfo, setDeliveryInfo] = useState(record.deliveryInfo || "");

  const saveEdit = () => {
    if (!productName.trim() || !supplierName.trim()) return;
    store.updatePricing(record.id, {
      productName: productName.trim(),
      supplierName: supplierName.trim(),
      unitPrice: Number(unitPrice) || 0,
      quantity: quantity ? Number(quantity) : undefined,
      deliveryInfo: deliveryInfo.trim() || undefined,
    });
    setEditing(false);
  };

  return (
    <div
      className={cn(
        "brand-card overflow-hidden",
        isPending && "ring-1 ring-accent/30",
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-divider bg-elevated/50 px-5 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
          {isPending ? "Human review required" : "Pricing record"}
        </span>
        <StatusBadge status={record.status} />
      </div>
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary mb-2">
            Original source
          </div>
          <div className="rounded-control bg-canvas border border-divider px-4 py-3 text-[14px] leading-relaxed text-ink">
            {record.originalText || "—"}
          </div>
          <div className="mt-2 text-[12px] text-ink-tertiary">
            Source: {record.source}
            {record.extractedAt
              ? ` · Extracted ${new Date(record.extractedAt).toLocaleDateString("en-GB")}`
              : ""}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary mb-2">
            Extracted data
          </div>
          {editing ? (
            <div className="grid gap-2">
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} aria-label="Supplier" className={inputClass} placeholder="Supplier" />
              <input value={productName} onChange={(e) => setProductName(e.target.value)} aria-label="Product" className={inputClass} placeholder="Product" />
              <div className="grid grid-cols-2 gap-2">
                <input value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" type="number" className={inputClass} placeholder="Quantity" />
                <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} aria-label="Unit price" type="number" className={inputClass} placeholder="Unit price" />
              </div>
              <input value={deliveryInfo} onChange={(e) => setDeliveryInfo(e.target.value)} aria-label="Delivery" className={inputClass} placeholder="Delivery information" />
            </div>
          ) : (
          <div className="space-y-2 text-[14px]">
            {[
              ["Supplier", record.supplierName],
              ["Product", record.productName],
              ["Quantity", record.quantity != null ? String(record.quantity) : "—"],
              ["Unit price", `${record.unitPrice} ${record.currency}`],
              ["Delivery", record.deliveryInfo || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-divider/60 pb-2 last:border-0">
                <span className="text-ink-secondary">{k}</span>
                <span className="font-medium text-ink text-right">{v}</span>
              </div>
            ))}
          </div>
          )}
          {isPending ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="rounded-full bg-[rgb(var(--accent-deep))] hover:bg-[rgb(var(--accent-deep))]/90 text-white font-semibold px-4"
                onClick={() => store.approvePricing(record.id)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full border-divider font-semibold px-4"
                onClick={() => store.rejectPricing(record.id)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-ink-secondary px-3"
                onClick={() => editing ? saveEdit() : setEditing(true)}
              >
                {editing ? "Save edit" : "Edit"}
              </Button>
              {editing ? (
                <Button size="sm" variant="ghost" className="rounded-full text-ink-secondary px-3" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}


/* -------------------------------------------------------------------------- */
/* Line-item editing — shared by the quotation and order forms                */
/* -------------------------------------------------------------------------- */

/**
 * Editable table of document lines. Selecting a product fills the description
 * and unit price from the catalogue but leaves both editable, so a negotiated
 * price doesn't require abandoning the product link.
 */
function LineItemsEditor({
  lines,
  onChange,
  currency,
}: {
  lines: DraftLine[];
  onChange: (next: DraftLine[]) => void;
  currency: string;
}) {
  const { products } = useStore();

  const patch = (id: string, changes: Partial<DraftLine>) =>
    onChange(lines.map((line) => (line.id === id ? { ...line, ...changes } : line)));

  const applyProduct = (id: string, productId: string) => {
    if (!productId) {
      patch(id, { productId: undefined });
      return;
    }
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const line = lines.find((l) => l.id === id);
    patch(id, {
      productId,
      // Only overwrite fields the user hasn't already filled in by hand.
      description: line?.description.trim() ? line.description : `${product.name} (${product.sku})`,
      unitPrice: line?.unitPrice ? line.unitPrice : product.sellingPrice ?? 0,
    });
  };

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div key={line.id} className="rounded-control border border-divider bg-canvas p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-tertiary">Line {index + 1}</span>
            <button
              type="button"
              onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
              disabled={lines.length === 1}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-ink-secondary hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Product (optional)">
              <SelectInput
                value={line.productId || ""}
                onChange={(v) => applyProduct(line.id, v)}
                options={[
                  { value: "", label: "Free-text line" },
                  ...products.map((p) => ({ value: p.id, label: `${p.name} — ${p.sku}` })),
                ]}
              />
            </Field>
            <Field label="Description" required>
              <TextInput
                value={line.description}
                onChange={(e) => patch(line.id, { description: e.target.value })}
                placeholder="What is being supplied"
              />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Field label="Quantity">
              <TextInput
                type="number"
                min={0}
                value={line.quantity}
                onChange={(e) => patch(line.id, { quantity: Number(e.target.value) })}
              />
            </Field>
            <Field label={`Unit price (${currency})`}>
              <TextInput
                type="number"
                min={0}
                step="0.01"
                value={line.unitPrice}
                onChange={(e) => patch(line.id, { unitPrice: Number(e.target.value) })}
              />
            </Field>
            <Field label="Discount %">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={line.discountPct ?? 0}
                onChange={(e) => patch(line.id, { discountPct: Number(e.target.value) })}
              />
            </Field>
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-ink-secondary">Line total</span>
              <div className="flex h-11 items-center justify-end rounded-control border border-transparent bg-elevated px-3 text-[15px] font-semibold tabular-nums">
                {formatMoneyExact(lineNet(line), currency)}
              </div>
            </div>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...lines, blankLine()])}
        className="inline-flex items-center gap-1.5 rounded-control border border-dashed border-divider px-3 py-2.5 text-[13px] font-medium text-ink-secondary hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" />
        Add line
      </button>
    </div>
  );
}

/** Subtotal / tax / total readout shown beneath a line editor. */
function TotalsPanel({
  lines,
  taxRatePct,
  currency,
}: {
  lines: DraftLine[];
  taxRatePct: number;
  currency: string;
}) {
  const totals = useMemo(() => computeTotals(lines, taxRatePct), [lines, taxRatePct]);
  return (
    <div className="brand-card p-5 sm:p-6">
      <dl className="ml-auto w-full max-w-xs space-y-2 text-[14px]">
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Subtotal</dt>
          <dd className="tabular-nums">{formatMoneyExact(totals.subtotal, currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Tax at {taxRatePct}%</dt>
          <dd className="tabular-nums">{formatMoneyExact(totals.tax, currency)}</dd>
        </div>
        <AccentRule />
        <div className="flex justify-between pt-1 text-[17px] font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoneyExact(totals.total, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}

const QUOTATION_STATUS_FLOW: Record<string, { next: QuotationStatus; label: string }[]> = {
  draft: [{ next: "sent", label: "Mark sent" }],
  sent: [
    { next: "accepted", label: "Mark accepted" },
    { next: "rejected", label: "Mark rejected" },
  ],
  viewed: [
    { next: "accepted", label: "Mark accepted" },
    { next: "rejected", label: "Mark rejected" },
  ],
};

/**
 * Create / edit form shared by new quotations and draft revisions. Orders reuse
 * the same shape via `mode`, so a line change behaves identically either side of
 * the quotation → order conversion.
 */
function DocumentForm({
  mode,
  onCancel,
  onSubmit,
  initial,
}: {
  mode: "quotation" | "order";
  onCancel: () => void;
  onSubmit: (input: {
    customerId: string;
    title: string;
    currency: string;
    lines: DraftLine[];
    taxRatePct: number;
    validUntil?: string;
    deliveryDate?: string;
  }) => void;
  initial?: {
    customerId?: string;
    title?: string;
    currency?: string;
    lines?: DraftLine[];
    taxRatePct?: number;
  };
}) {
  const store = useStore();
  const [customerId, setCustomerId] = useState(initial?.customerId || store.customers[0]?.id || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [currency, setCurrency] = useState(initial?.currency || store.organisation.defaultCurrency || "GBP");
  const [taxRatePct, setTaxRatePct] = useState(
    initial?.taxRatePct ?? store.salesSettings.defaultTaxRatePct ?? 0,
  );
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines?.length ? initial.lines : [blankLine()]);
  const [validUntil, setValidUntil] = useState(() =>
    new Date(Date.now() + (store.salesSettings.quotationValidityDays || 30) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const [deliveryDate, setDeliveryDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isQuotation = mode === "quotation";
  const hasUsableLine = lines.some((l) => l.description.trim() && lineNet(l) >= 0);

  const submit = () => {
    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (!title.trim()) {
      setError("Give the document a title so it can be found later.");
      return;
    }
    if (!hasUsableLine) {
      setError("At least one line needs a description.");
      return;
    }
    setError(null);
    onSubmit({
      customerId,
      title: title.trim(),
      currency,
      lines,
      taxRatePct,
      validUntil: isQuotation && validUntil ? new Date(validUntil).toISOString() : undefined,
      deliveryDate: !isQuotation && deliveryDate ? new Date(deliveryDate).toISOString() : undefined,
    });
  };

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink label={isQuotation ? "Quotations" : "Orders"} onClick={onCancel} />
      <h1 className="text-[28px] font-semibold tracking-tight">
        {isQuotation ? "New quotation" : "New order"}
      </h1>

      <FormSection
        title="Header"
        description={
          isQuotation
            ? "Numbering and validity come from Settings → Sales."
            : "Raised directly, without an originating quotation."
        }
      >
        <Field label="Customer" required>
          <SelectInput
            value={customerId}
            onChange={setCustomerId}
            options={store.customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Title / reference" required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q2 PCB supply"
          />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} />
        </Field>
        <Field label="Tax rate %" hint="Applied to the subtotal after line discounts.">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={taxRatePct}
            onChange={(e) => setTaxRatePct(Number(e.target.value))}
          />
        </Field>
        {isQuotation ? (
          <Field label="Valid until">
            <TextInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        ) : (
          <Field label="Delivery date">
            <TextInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </Field>
        )}
      </FormSection>

      <div className="brand-card p-5 sm:p-6 space-y-4">
        <div>
          <div className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">Lines</div>
          <p className="mt-0.5 text-[12px] text-ink-tertiary">
            Pick a catalogue product to prefill, or type a free-text line.
          </p>
        </div>
        <LineItemsEditor lines={lines} onChange={setLines} currency={currency} />
      </div>

      <TotalsPanel lines={lines} taxRatePct={taxRatePct} currency={currency} />

      {error ? <p className="text-[13px] font-medium text-accent">{error}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <PrimaryButton onClick={submit}>
          {isQuotation ? "Create draft quotation" : "Create draft order"}
        </PrimaryButton>
        <Button variant="outline" className="h-12 rounded-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function QuotationsPage({ initialCustomerId }: { initialCustomerId?: string | null } = {}) {
  const store = useStore();
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const followUps = store.quotations.filter((q) => q.status === "sent");

  // Arriving here from a "New quotation" shortcut on a customer's own page —
  // open the real builder pre-filled with that customer instead of requiring
  // a second click, but only react to a *change* in the incoming id so
  // dismissing the form (Cancel) doesn't immediately reopen it.
  const lastPrefill = useRef<string | null>(null);
  useEffect(() => {
    if (initialCustomerId && initialCustomerId !== lastPrefill.current) {
      lastPrefill.current = initialCustomerId;
      setCreating(true);
    }
  }, [initialCustomerId]);

  if (creating) {
    return (
      <DocumentForm
        mode="quotation"
        initial={initialCustomerId ? { customerId: initialCustomerId } : undefined}
        onCancel={() => setCreating(false)}
        onSubmit={(input) => {
          store.addQuotation(input);
          setCreating(false);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Quotations</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            Pipeline · follow-ups · convert to order
            {followUps.length > 0 ? (
              <span className="ml-2 text-accent font-medium">· {followUps.length} need follow-up</span>
            ) : null}
          </p>
        </div>
        <Button
          className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm"
          onClick={() => setCreating(true)}
        >
          New quotation
        </Button>
      </div>

      {store.quotations.length === 0 ? (
        <EmptyState icon={FileText} title="No quotations yet" description="Create one to start a sales pipeline." />
      ) : (
        <div className="brand-card overflow-hidden divide-y divide-divider">
          {store.quotations.map((q) => {
            const c = store.customers.find((x) => x.id === q.customerId);
            const needsFollowUp = q.status === "sent";
            const expanded = expandedId === q.id;
            const expiresSoon =
              q.validUntil && q.status !== "converted" &&
              new Date(q.validUntil).getTime() - Date.now() < 7 * 86400000;
            return (
              <div key={q.id} className={needsFollowUp ? "bg-accent/5" : ""}>
                <div className="px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : q.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-[15px] font-semibold font-mono">{q.number}</div>
                    <div className="text-[13px] text-ink-secondary truncate">
                      {c?.name || "—"} · {q.lines.length} line{q.lines.length === 1 ? "" : "s"} ·{" "}
                      {formatMoney(q.total, q.currency)}
                      {expiresSoon ? (
                        <span className="ml-2 font-medium text-accent">
                          · expires {shortDate(q.validUntil as string)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                  <StatusBadge status={q.status} />
                  <div className="flex flex-wrap gap-2">
                    {(QUOTATION_STATUS_FLOW[q.status] || []).map((step) => (
                      <Button
                        key={step.next}
                        size="sm"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() => store.updateQuotationStatus(q.id, step.next)}
                      >
                        {step.label}
                      </Button>
                    ))}
                    {q.status === "accepted" || q.status === "sent" ? (
                      <Button
                        size="sm"
                        className="rounded-lg bg-accent"
                        onClick={() => store.convertQuotationToOrder(q.id)}
                      >
                        → Order
                      </Button>
                    ) : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="border-t border-divider bg-elevated/50 px-4 py-4">
                    <LineTable lines={q.lines} currency={q.currency} />
                    <dl className="mt-3 ml-auto w-full max-w-xs space-y-1.5 text-[13px]">
                      <div className="flex justify-between">
                        <dt className="text-ink-secondary">Subtotal</dt>
                        <dd className="tabular-nums">{formatMoneyExact(q.subtotal, q.currency)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-ink-secondary">Tax</dt>
                        <dd className="tabular-nums">{formatMoneyExact(q.tax, q.currency)}</dd>
                      </div>
                      <div className="flex justify-between font-semibold">
                        <dt>Total</dt>
                        <dd className="tabular-nums">{formatMoneyExact(q.total, q.currency)}</dd>
                      </div>
                    </dl>
                    {q.validUntil ? (
                      <p className="mt-3 text-[12px] text-ink-tertiary">
                        Valid until {shortDate(q.validUntil)}
                        {q.convertedOrderId ? " · converted to order" : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Read-only rendering of persisted document lines. */
function LineTable({ lines, currency }: { lines: QuotationLine[]; currency: string }) {
  if (!lines.length) return <p className="text-[13px] text-ink-tertiary">No lines recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-divider text-left text-[12px] text-ink-tertiary">
            <th className="py-2 pr-3 font-medium">Description</th>
            <th className="py-2 px-3 font-medium text-right">Qty</th>
            <th className="py-2 px-3 font-medium text-right">Unit</th>
            <th className="py-2 px-3 font-medium text-right">Disc.</th>
            <th className="py-2 pl-3 font-medium text-right">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="py-2 pr-3">{line.description}</td>
              <td className="py-2 px-3 text-right tabular-nums">{line.quantity}</td>
              <td className="py-2 px-3 text-right tabular-nums">
                {formatMoneyExact(line.unitPrice, currency)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {line.discountPct ? `${line.discountPct}%` : "—"}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums font-medium">
                {formatMoneyExact(lineNet(line), currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/**
 * Invoices — a filterable ledger that opens into the real document.
 *
 * The list answers "what is outstanding"; the preview answers "what does the
 * customer actually see". Both matter, so neither is hidden behind the other.
 */
function InvoicesPage({
  initialInvoiceId,
  onOpenRecord,
}: {
  initialInvoiceId?: string;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [openId, setOpenId] = useState<string | null>(initialInvoiceId ?? null);
  const [filter, setFilter] = useState<"all" | "outstanding" | "overdue" | "paid">("all");
  const [q, setQ] = useState("");

  // Respond to a drill-down arriving from another module (mail, dashboard),
  // but only on a genuine change so closing the preview doesn't reopen it.
  const lastFocus = useRef<string | null>(null);
  useEffect(() => {
    if (initialInvoiceId && initialInvoiceId !== lastFocus.current) {
      lastFocus.current = initialInvoiceId;
      setOpenId(initialInvoiceId);
    }
  }, [initialInvoiceId]);

  const open = openId ? store.invoices.find((i) => i.id === openId) : null;

  const rows = useMemo(() => {
    const now = Date.now();
    const text = q.trim().toLowerCase();
    return store.invoices
      .filter((inv) => {
        const paidAmount = inv.amountPaid ?? (inv.status === "paid" ? inv.total : 0);
        const balance = inv.total - paidAmount;
        const isOverdue =
          balance > 0 &&
          inv.status !== "paid" &&
          inv.status !== "cancelled" &&
          !!inv.dueAt &&
          new Date(inv.dueAt).getTime() < now;
        if (filter === "outstanding") return balance > 0 && inv.status !== "cancelled";
        if (filter === "overdue") return isOverdue;
        if (filter === "paid") return inv.status === "paid";
        return true;
      })
      .filter((inv) => {
        if (!text) return true;
        const customer = store.customers.find((c) => c.id === inv.customerId);
        return (
          inv.number.toLowerCase().includes(text) ||
          (customer?.name.toLowerCase().includes(text) ?? false)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.issuedAt ?? b.createdAt).getTime() -
          new Date(a.issuedAt ?? a.createdAt).getTime(),
      );
  }, [store.invoices, store.customers, filter, q]);

  const totals = useMemo(() => {
    const now = Date.now();
    let outstanding = 0;
    let overdue = 0;
    let collected = 0;
    for (const inv of store.invoices) {
      if (inv.status === "cancelled") continue;
      const paidAmount = inv.amountPaid ?? (inv.status === "paid" ? inv.total : 0);
      const balance = inv.total - paidAmount;
      collected += paidAmount;
      outstanding += balance;
      if (balance > 0 && inv.dueAt && new Date(inv.dueAt).getTime() < now) overdue += balance;
    }
    return { outstanding, overdue, collected };
  }, [store.invoices]);

  if (open) {
    return (
      <InvoicePreview
        invoice={open}
        onBack={() => setOpenId(null)}
        onOpenRecord={onOpenRecord}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[34px] font-semibold leading-none tracking-tight text-ink">Invoices</h1>
        <p className="mt-2 text-[14px] text-ink-secondary">
          Open any invoice to see the document exactly as the customer receives it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="brand-card p-4">
          <div className="text-[12px] text-ink-secondary">Outstanding</div>
          <div className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            {formatMoney(totals.outstanding)}
          </div>
        </div>
        <div className="brand-card p-4">
          <div className="text-[12px] text-ink-secondary">Overdue</div>
          <div
            className={cn(
              "mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight",
              totals.overdue > 0 ? "text-accent" : "text-ink",
            )}
          >
            {formatMoney(totals.overdue)}
          </div>
        </div>
        <div className="brand-card p-4">
          <div className="text-[12px] text-ink-secondary">Collected</div>
          <div className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            {formatMoney(totals.collected)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-[360px]">
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            options={[
              { id: "all", label: "All" },
              { id: "outstanding", label: "Outstanding" },
              { id: "overdue", label: "Overdue" },
              { id: "paid", label: "Paid" },
            ]}
          />
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by number or customer…"
          className={inputClass + " sm:max-w-[280px]"}
        />
      </div>

      <div className="brand-card divide-y divide-divider overflow-hidden">
        {rows.map((inv) => {
          const customer = store.customers.find((x) => x.id === inv.customerId);
          const paidAmount = inv.amountPaid ?? (inv.status === "paid" ? inv.total : 0);
          const balance = inv.total - paidAmount;
          const overdueBy =
            balance > 0 && inv.dueAt
              ? Math.floor((Date.now() - new Date(inv.dueAt).getTime()) / 86400000)
              : 0;
          return (
            <button
              key={inv.id}
              type="button"
              onClick={() => setOpenId(inv.id)}
              className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-elevated sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[14px] font-semibold text-ink">{inv.number}</span>
                  {overdueBy > 0 ? (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      {overdueBy}d overdue
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[13px] text-ink-secondary">
                  {customer?.name || "—"} · issued {relativeDay(inv.issuedAt ?? inv.createdAt)}
                </div>
              </div>
              <div className="text-right sm:w-[150px]">
                <div className="text-[14px] font-semibold tabular-nums text-ink">
                  {formatMoney(inv.total, inv.currency)}
                </div>
                {balance > 0 && balance !== inv.total ? (
                  <div className="text-[11.5px] tabular-nums text-ink-tertiary">
                    {formatMoney(balance, inv.currency)} due
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 sm:w-[110px] sm:text-right">
                <StatusBadge status={inv.status} />
              </div>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-ink-tertiary sm:block" />
            </button>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-secondary">
            No invoices match this filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}

const OPPORTUNITY_STAGES: OpportunityStage[] = [
  "enquiry",
  "quotation",
  "order",
  "delivery",
  "invoice",
  "payment",
  "closed_won",
  "closed_lost",
];

const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  enquiry: "Enquiry",
  quotation: "Quotation",
  order: "Order",
  delivery: "Delivery",
  invoice: "Invoice",
  payment: "Payment",
  closed_won: "Won",
  closed_lost: "Lost",
};

/** Create / edit form for a single opportunity. */
function OpportunityForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: Opportunity;
  onCancel: () => void;
  onSubmit: (input: OpportunityInput) => void;
}) {
  const store = useStore();
  const [customerId, setCustomerId] = useState(initial?.customerId || store.customers[0]?.id || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [stage, setStage] = useState<OpportunityStage>(initial?.stage || "enquiry");
  const [value, setValue] = useState(initial?.value != null ? String(initial.value) : "");
  const [currency, setCurrency] = useState(
    initial?.currency || store.organisation.defaultCurrency || "GBP",
  );
  const [requirementId, setRequirementId] = useState(initial?.requirementId || "");
  const [productId, setProductId] = useState(initial?.productId || "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId || "");
  const [ownerId, setOwnerId] = useState(initial?.ownerId || store.user?.id || "");
  const [nextAction, setNextAction] = useState(initial?.nextAction || "");
  const [nextActionDue, setNextActionDue] = useState(
    initial?.nextActionDue ? initial.nextActionDue.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(initial?.notes || "");
  const [error, setError] = useState<string | null>(null);

  // Requirements belong to a customer, so only offer the ones that can legally
  // be linked to the currently selected account.
  const availableRequirements = store.requirements.filter((r) => r.customerId === customerId);

  const submit = () => {
    if (!customerId) {
      setError("Select a customer.");
      return;
    }
    if (!title.trim()) {
      setError("Give the opportunity a title.");
      return;
    }
    setError(null);
    onSubmit({
      customerId,
      title: title.trim(),
      stage,
      value: value.trim() ? Number(value) : undefined,
      currency,
      requirementId: requirementId || undefined,
      productId: productId || undefined,
      supplierId: supplierId || undefined,
      ownerId: ownerId || undefined,
      nextAction: nextAction.trim() || undefined,
      nextActionDue: nextActionDue ? new Date(nextActionDue).toISOString() : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="max-w-4xl space-y-5">
      <BackLink label="Opportunities" onClick={onCancel} />
      <h1 className="text-[28px] font-semibold tracking-tight">
        {initial ? "Edit opportunity" : "New opportunity"}
      </h1>

      <FormSection title="Commercial">
        <Field label="Customer" required>
          <SelectInput
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setRequirementId("");
            }}
            options={store.customers.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Field>
        <Field label="Title" required>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Aether — 10k FR4 boards"
          />
        </Field>
        <Field label="Stage">
          <SelectInput
            value={stage}
            onChange={(v) => setStage(v as OpportunityStage)}
            options={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: OPPORTUNITY_STAGE_LABELS[s] }))}
          />
        </Field>
        <Field label="Estimated value" hint="Leave blank until the figure is real.">
          <TextInput
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Currency">
          <SelectInput value={currency} onChange={setCurrency} options={CURRENCY_OPTIONS} />
        </Field>
        <Field label="Owner">
          <SelectInput
            value={ownerId}
            onChange={setOwnerId}
            options={[
              { value: "", label: "Unassigned" },
              ...store.users.map((u) => ({ value: u.id, label: `${u.name} — ${ROLE_LABELS[u.role]}` })),
            ]}
          />
        </Field>
      </FormSection>

      <FormSection
        title="Sourcing links"
        description="Optional. Links here let the pipeline trace back to the requirement and the supplier offer behind it."
      >
        <Field label="Customer requirement">
          <SelectInput
            value={requirementId}
            onChange={setRequirementId}
            options={[
              { value: "", label: availableRequirements.length ? "Not linked" : "No requirements for this customer" },
              ...availableRequirements.map((r) => ({ value: r.id, label: r.productName })),
            ]}
          />
        </Field>
        <Field label="Product">
          <SelectInput
            value={productId}
            onChange={setProductId}
            options={[
              { value: "", label: "Not linked" },
              ...store.products.map((p) => ({ value: p.id, label: `${p.name} — ${p.sku}` })),
            ]}
          />
        </Field>
        <Field label="Intended supplier">
          <SelectInput
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: "", label: "Not decided" },
              ...store.suppliers.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </Field>
      </FormSection>

      <FormSection title="Follow-up" cols={2}>
        <Field label="Next action">
          <TextInput
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="e.g. Send revised quotation"
          />
        </Field>
        <Field label="Due">
          <TextInput
            type="date"
            value={nextActionDue}
            onChange={(e) => setNextActionDue(e.target.value)}
          />
        </Field>
        <Field label="Notes" full>
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </FormSection>

      {error ? <p className="text-[13px] font-medium text-accent">{error}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <PrimaryButton onClick={submit}>{initial ? "Save changes" : "Create opportunity"}</PrimaryButton>
        <Button variant="outline" className="h-12 rounded-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function OpportunitiesPage() {
  const store = useStore();
  const [mode, setMode] = useState<{ kind: "list" } | { kind: "new" } | { kind: "edit"; id: string }>({
    kind: "list",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<"open" | "all" | "closed">("open");

  const notify = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(null), 4000);
  };

  if (mode.kind === "new") {
    return (
      <OpportunityForm
        onCancel={() => setMode({ kind: "list" })}
        onSubmit={(input) => {
          store.addOpportunity(input);
          setMode({ kind: "list" });
          notify("Opportunity added to the pipeline.");
        }}
      />
    );
  }

  if (mode.kind === "edit") {
    const target = store.opportunities.find((o) => o.id === mode.id);
    if (target) {
      return (
        <OpportunityForm
          initial={target}
          onCancel={() => setMode({ kind: "list" })}
          onSubmit={(input) => {
            store.updateOpportunity(target.id, {
              ...input,
              requirementId: input.requirementId,
              productId: input.productId,
              supplierId: input.supplierId,
            });
            setMode({ kind: "list" });
            notify("Opportunity updated.");
          }}
        />
      );
    }
  }

  const closedStages: OpportunityStage[] = ["closed_won", "closed_lost"];
  const visible = store.opportunities.filter((o) => {
    if (stageFilter === "all") return true;
    const isClosed = closedStages.includes(o.stage);
    return stageFilter === "closed" ? isClosed : !isClosed;
  });

  const openValue = store.opportunities
    .filter((o) => !closedStages.includes(o.stage))
    .reduce((sum, o) => sum + (o.value || 0), 0);
  const overdue = store.opportunities.filter(
    (o) =>
      o.nextActionDue &&
      !closedStages.includes(o.stage) &&
      new Date(o.nextActionDue).getTime() < Date.now(),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Opportunities</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            Enquiry → Quotation → Order → Delivery → Invoice
            {overdue > 0 ? (
              <span className="ml-2 font-medium text-accent">· {overdue} follow-up overdue</span>
            ) : null}
          </p>
          {message ? <p className="mt-2 text-sm font-medium text-accent">{message}</p> : null}
        </div>
        <Button
          className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm"
          onClick={() => setMode({ kind: "new" })}
        >
          New opportunity
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <BrandCard className="p-4">
          <StatBlock label="Open pipeline value" value={formatMoney(openValue, "GBP")} />
        </BrandCard>
        <BrandCard className="p-4">
          <StatBlock
            label="Open opportunities"
            value={String(store.opportunities.filter((o) => !closedStages.includes(o.stage)).length)}
          />
        </BrandCard>
        <BrandCard className="p-4">
          <StatBlock label="Follow-ups overdue" value={String(overdue)} />
        </BrandCard>
      </div>

      <SegmentedControl
        value={stageFilter}
        onChange={(v) => setStageFilter(v as "open" | "all" | "closed")}
        options={[
          { id: "open", label: "Open" },
          { id: "closed", label: "Closed" },
          { id: "all", label: "All" },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Nothing here"
          description="No opportunities match this filter. Create one to start tracking a deal."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((o) => {
            const c = store.customers.find((x) => x.id === o.customerId);
            const supplier = store.suppliers.find((x) => x.id === o.supplierId);
            const linkedQuotes = store.quotations.filter((q) => q.opportunityId === o.id);
            const dueSoon =
              o.nextActionDue && new Date(o.nextActionDue).getTime() < Date.now() + 86400000;
            return (
              <div key={o.id} className="brand-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold truncate">{o.title || "Opportunity"}</div>
                    <div className="text-[13px] text-ink-secondary truncate">
                      {c?.name || "—"}
                      {supplier ? ` · via ${supplier.name}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[12px] font-semibold text-accent tabular-nums">
                    {o.value != null ? formatMoney(o.value, o.currency || "GBP") : "—"}
                  </span>
                </div>

                {o.nextAction ? (
                  <p className={cn("text-[12px]", dueSoon ? "font-medium text-accent" : "text-ink-tertiary")}>
                    {o.nextAction}
                    {o.nextActionDue ? ` · ${relativeDay(o.nextActionDue)}` : ""}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-1">
                  {OPPORTUNITY_STAGES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => store.updateOpportunityStage(o.id, st)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        o.stage === st
                          ? "bg-accent text-white"
                          : "bg-elevated text-ink-secondary hover:bg-[rgb(var(--divider))]",
                      )}
                    >
                      {OPPORTUNITY_STAGE_LABELS[st]}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg text-xs h-8"
                    onClick={() => setMode({ kind: "edit", id: o.id })}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg text-xs h-8"
                    onClick={() => {
                      store.addQuotation({
                        customerId: o.customerId,
                        title: o.title,
                        currency: o.currency || "GBP",
                        opportunityId: o.id,
                        total: o.value ?? 0,
                      });
                      notify("Draft quotation created — open Quotations to add lines.");
                    }}
                  >
                    Draft quotation
                  </Button>
                  {linkedQuotes.length ? (
                    <span className="text-[11px] text-ink-tertiary">
                      {linkedQuotes.length} linked quotation{linkedQuotes.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      store.removeOpportunity(o.id);
                      notify("Opportunity removed.");
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-ink-tertiary hover:bg-elevated hover:text-ink-secondary"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommsPage({ channel }: { channel: string }) {
  const store = useStore();
  const { communications } = store;
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const filtered = communications.filter((c) =>
    channel === "email" ? c.channel === "email" : c.channel === "whatsapp",
  );
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight capitalize">{channel}</h1>
          <p className="text-sm text-ink-secondary mt-1">
            Historical extraction: received messages from February 2025 onwards only.
            Sent messages stay in the timeline but are never extracted.
          </p>
        </div>
        {channel === "email" && (
          <Button
            className="rounded-xl bg-accent hover:bg-accent/90"
            onClick={() => {
              const r = store.runHistoricalEmailScan();
              setScanMessage(r.message);
            }}
          >
            Run historical scan
          </Button>
        )}
      </div>
      {scanMessage ? (
        <div className="brand-card flex items-start justify-between gap-3 p-4 text-sm text-ink-secondary">
          <span>{scanMessage}</span>
          <button type="button" className="shrink-0 text-accent" onClick={() => setScanMessage(null)} aria-label="Dismiss scan result">Dismiss</button>
        </div>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyModule
          title={`No ${channel} messages`}
          message="Connect your mailbox or WhatsApp Business API in Settings → Integrations."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="brand-card p-5"
            >
              <div className="flex items-center justify-between gap-4 mb-2">
                <span className="text-sm font-medium">{c.subject || "(no subject)"}</span>
                <span className="text-xs text-ink-tertiary">
                  {c.isReceived ? "Received" : "Sent"} ·{" "}
                  {new Date(c.occurredAt).toLocaleDateString("en-GB")}
                </span>
              </div>
              <p className="text-sm text-ink-secondary line-clamp-2">{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrganisationPanel({
  PanelShell,
  showToast,
}: {
  PanelShell: React.ComponentType<{ title: string; children: ReactNode }>;
  showToast: (msg: string) => void;
}) {
  const store = useStore();
  const [form, setForm] = useState(store.organisation);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    store.updateOrganisation(form);
    showToast("Organisation profile saved");
  };

  return (
    <PanelShell title="Organisation">
      <div className="brand-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Legal name" required>
          <TextInput value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
        </Field>
        <Field label="Trading as">
          <TextInput value={form.tradingName || ""} onChange={(e) => set("tradingName", e.target.value)} />
        </Field>
        <Field label="Address line 1" full>
          <TextInput value={form.addressLine1 || ""} onChange={(e) => set("addressLine1", e.target.value)} />
        </Field>
        <Field label="Address line 2" full>
          <TextInput value={form.addressLine2 || ""} onChange={(e) => set("addressLine2", e.target.value)} />
        </Field>
        <Field label="City">
          <TextInput value={form.city || ""} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Postcode">
          <TextInput value={form.postcode || ""} onChange={(e) => set("postcode", e.target.value)} />
        </Field>
        <Field label="Country" required>
          <TextInput value={form.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
        <Field label="Default currency">
          <SelectInput
            value={form.defaultCurrency}
            onChange={(v) => set("defaultCurrency", v)}
            options={[
              { value: "GBP", label: "GBP — British Pound" },
              { value: "USD", label: "USD — US Dollar" },
              { value: "EUR", label: "EUR — Euro" },
            ]}
          />
        </Field>
        <Field label="VAT number">
          <TextInput value={form.vatNumber || ""} onChange={(e) => set("vatNumber", e.target.value)} />
        </Field>
        <Field label="Company registration number">
          <TextInput value={form.registrationNumber || ""} onChange={(e) => set("registrationNumber", e.target.value)} />
        </Field>
        <Field label="Phone">
          <TextInput value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <TextInput value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Website" full>
          <TextInput value={form.website || ""} onChange={(e) => set("website", e.target.value)} />
        </Field>
      </div>
      <Button className="w-full h-12 rounded-full bg-accent text-white font-semibold" onClick={save}>
        Save changes
      </Button>
      <p className="text-[13px] text-ink-tertiary px-1">
        Used across quotations, invoices, and the company header. Stored locally for this demo session.
      </p>
    </PanelShell>
  );
}

function CrmSettingsPanel({
  PanelShell,
  showToast,
}: {
  PanelShell: React.ComponentType<{ title: string; children: ReactNode }>;
  showToast: (msg: string) => void;
}) {
  const store = useStore();
  const s = store.crmSettings;
  const [leadSources, setLeadSources] = useState(s.leadSources.join(", "));
  const [segments, setSegments] = useState(s.customerSegments.join(", "));
  const [territories, setTerritories] = useState(s.salesTerritories.join(", "));
  const [followUpDays, setFollowUpDays] = useState(String(s.followUpReminderDays));
  const [expiryWarningDays, setExpiryWarningDays] = useState(String(s.documentExpiryWarningDays));
  const [requireKyc, setRequireKyc] = useState(s.requireKycForOnboarding);

  const save = () => {
    const nextTerritories = territories.split(",").map((t) => t.trim()).filter(Boolean);
    store.updateCrmSettings({
      leadSources: leadSources.split(",").map((t) => t.trim()).filter(Boolean),
      customerSegments: segments.split(",").map((t) => t.trim()).filter(Boolean),
      salesTerritories: nextTerritories,
      followUpReminderDays: Number(followUpDays) || s.followUpReminderDays,
      // Zero is a legitimate setting ("warn only once expired"), so guard on
      // NaN rather than on falsiness.
      documentExpiryWarningDays: Number.isFinite(Number(expiryWarningDays))
        ? Math.max(0, Number(expiryWarningDays))
        : s.documentExpiryWarningDays,
      requireKycForOnboarding: requireKyc,
    });
    showToast("CRM settings saved");
  };

  // Territories already in use that the edit box no longer contains — removing
  // them would orphan those customers, so say so before the save happens.
  const pendingTerritories = new Set(
    territories.split(",").map((t) => t.trim()).filter(Boolean),
  );
  const orphaned = Array.from(
    new Set(
      store.customers
        .map((c) => c.territory)
        .filter((t): t is string => Boolean(t) && !pendingTerritories.has(t as string)),
    ),
  );

  return (
    <PanelShell title="CRM">
      <div className="brand-card p-4 space-y-4">
        <Field label="Lead sources" hint="Comma-separated, shown when logging a new lead">
          <TextInput value={leadSources} onChange={(e) => setLeadSources(e.target.value)} placeholder="Referral, Website, Trade show" />
        </Field>
        <Field label="Customer segments" hint="Comma-separated, used to classify customers">
          <TextInput value={segments} onChange={(e) => setSegments(e.target.value)} placeholder="Wholesale, Retail, Distributor" />
        </Field>
        <Field label="Sales territories" hint="Comma-separated, offered when assigning a customer">
          <TextInput
            value={territories}
            onChange={(e) => setTerritories(e.target.value)}
            placeholder="UK & Ireland, Northern Europe, Middle East"
          />
        </Field>
        {orphaned.length > 0 ? (
          <p className="-mt-2 text-[12px] text-accent">
            {orphaned.join(", ")} {orphaned.length === 1 ? "is" : "are"} still assigned to customers. Removing{" "}
            {orphaned.length === 1 ? "it" : "them"} will leave those accounts without a territory.
          </p>
        ) : null}
        <Field label="Follow-up reminder (days)" hint="Days of inactivity before a customer is flagged for follow-up">
          <TextInput type="number" value={followUpDays} onChange={(e) => setFollowUpDays(e.target.value)} />
        </Field>
        <Field
          label="Document expiry warning (days)"
          hint="How far ahead a contract, certificate or KYC pack is flagged as expiring"
        >
          <TextInput
            type="number"
            min="0"
            value={expiryWarningDays}
            onChange={(e) => setExpiryWarningDays(e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-[15px] font-medium">Require KYC for onboarding</div>
            <div className="text-[13px] text-ink-secondary">New customers must complete KYC before activation</div>
          </div>
          <button
            type="button"
            onClick={() => setRequireKyc((v) => !v)}
            className={cn(
              "h-7 w-12 shrink-0 rounded-full transition-colors relative",
              requireKyc ? "bg-accent" : "bg-elevated",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
                requireKyc ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </div>
      <Button className="w-full h-12 rounded-full bg-accent text-white font-semibold" onClick={save}>
        Save changes
      </Button>
    </PanelShell>
  );
}

function SalesSettingsPanel({
  PanelShell,
  showToast,
}: {
  PanelShell: React.ComponentType<{ title: string; children: ReactNode }>;
  showToast: (msg: string) => void;
}) {
  const store = useStore();
  const s = store.salesSettings;
  const [quotationPrefix, setQuotationPrefix] = useState(s.quotationPrefix);
  const [validityDays, setValidityDays] = useState(String(s.quotationValidityDays));
  const [orderPrefix, setOrderPrefix] = useState(s.orderPrefix);
  const [paymentTerms, setPaymentTerms] = useState(s.defaultPaymentTerms);
  const [taxRate, setTaxRate] = useState(String(s.defaultTaxRatePct));
  const [approvalAmount, setApprovalAmount] = useState(String(s.requireApprovalAboveAmount ?? ""));

  const save = () => {
    store.updateSalesSettings({
      quotationPrefix: quotationPrefix.trim() || s.quotationPrefix,
      quotationValidityDays: Number(validityDays) || s.quotationValidityDays,
      orderPrefix: orderPrefix.trim() || s.orderPrefix,
      defaultPaymentTerms: paymentTerms.trim() || s.defaultPaymentTerms,
      defaultTaxRatePct: Number(taxRate) || 0,
      requireApprovalAboveAmount: approvalAmount.trim() ? Number(approvalAmount) : undefined,
    });
    showToast("Sales settings saved");
  };

  return (
    <PanelShell title="Sales">
      <div className="brand-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Quotation number prefix">
          <TextInput value={quotationPrefix} onChange={(e) => setQuotationPrefix(e.target.value)} />
        </Field>
        <Field label="Quotation validity (days)">
          <TextInput type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} />
        </Field>
        <Field label="Order number prefix">
          <TextInput value={orderPrefix} onChange={(e) => setOrderPrefix(e.target.value)} />
        </Field>
        <Field label="Default payment terms">
          <TextInput value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="30 days" />
        </Field>
        <Field label="Default tax rate (%)">
          <TextInput type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
        </Field>
        <Field label="Require approval above" hint="Leave blank to disable approval threshold">
          <TextInput type="number" value={approvalAmount} onChange={(e) => setApprovalAmount(e.target.value)} placeholder="25000" />
        </Field>
      </div>
      <Button className="w-full h-12 rounded-full bg-accent text-white font-semibold" onClick={save}>
        Save changes
      </Button>
      <p className="text-[13px] text-ink-tertiary px-1">
        Applies to new quotations and orders created under Sales.
      </p>
    </PanelShell>
  );
}

function ProductSettingsPanel({
  PanelShell,
  showToast,
}: {
  PanelShell: React.ComponentType<{ title: string; children: ReactNode }>;
  showToast: (msg: string) => void;
}) {
  const store = useStore();
  const s = store.productSettings;
  const [categories, setCategories] = useState(s.categories.join(", "));
  const [units, setUnits] = useState(s.units.join(", "));
  const [currency, setCurrency] = useState(s.defaultCurrency);
  const [marginThreshold, setMarginThreshold] = useState(String(s.lowMarginThresholdPct));

  const save = () => {
    store.updateProductSettings({
      categories: categories.split(",").map((t) => t.trim()).filter(Boolean),
      units: units.split(",").map((t) => t.trim()).filter(Boolean),
      defaultCurrency: currency,
      lowMarginThresholdPct: Number(marginThreshold) || s.lowMarginThresholdPct,
    });
    showToast("Product settings saved");
  };

  return (
    <PanelShell title="Products">
      <div className="brand-card p-4 space-y-4">
        <Field label="Categories" hint="Comma-separated, offered when creating a product">
          <TextInput value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="General, Electronics, Packaging" />
        </Field>
        <Field label="Units of measure" hint="Comma-separated">
          <TextInput value={units} onChange={(e) => setUnits(e.target.value)} placeholder="unit, kg, box, pallet" />
        </Field>
        <Field label="Default currency">
          <SelectInput
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "GBP", label: "GBP — British Pound" },
              { value: "USD", label: "USD — US Dollar" },
              { value: "EUR", label: "EUR — Euro" },
            ]}
          />
        </Field>
        <Field label="Low margin alert threshold (%)" hint="Flag products whose margin falls below this">
          <TextInput type="number" value={marginThreshold} onChange={(e) => setMarginThreshold(e.target.value)} />
        </Field>
      </div>
      <Button className="w-full h-12 rounded-full bg-accent text-white font-semibold" onClick={save}>
        Save changes
      </Button>
    </PanelShell>
  );
}

type LegalSection = { heading: string; body: string[] };

function LegalDocument({ sections }: { sections: LegalSection[] }) {
  return (
    <div className="brand-card p-5 sm:p-7 space-y-6">
      <p className="text-[12px] text-ink-tertiary">
        Last updated {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} ·
        Renso Group, 843 Finchley Rd, London NW11 8NA
      </p>
      {sections.map((s) => (
        <div key={s.heading} className="space-y-2">
          <h3 className="text-[15px] font-semibold text-ink">{s.heading}</h3>
          {s.body.map((p, i) => (
            <p key={i} className="text-[13.5px] leading-relaxed text-ink-secondary">
              {p}
            </p>
          ))}
        </div>
      ))}
      <p className="text-[12px] text-ink-tertiary pt-2 border-t border-divider">
        This is a demo/prototype document for evaluation purposes and does not constitute legal advice.
        Renso Group should have this reviewed and finalised by qualified legal counsel before production use.
      </p>
    </div>
  );
}

const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. Acceptance of terms",
    body: [
      "By accessing or using the Renso Group commercial platform (\"the Platform\"), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the Platform.",
    ],
  },
  {
    heading: "2. Authorised use",
    body: [
      "Access is restricted to authorised Renso Group personnel and approved third parties. Accounts are personal and must not be shared. Users are responsible for all activity under their credentials.",
    ],
  },
  {
    heading: "3. Data & confidentiality",
    body: [
      "Customer, supplier and pricing data held in the Platform is confidential business information. It must not be exported, shared or disclosed outside Renso Group except as required for legitimate business purposes.",
    ],
  },
  {
    heading: "4. Acceptable use",
    body: [
      "The Platform must not be used to store or process unlawful content, to circumvent security controls, or in any way that could disrupt service for other users.",
    ],
  },
  {
    heading: "5. Availability & liability",
    body: [
      "The Platform is provided on an \"as is\" basis during its prototype/demo phase. Renso Group and its developers make no warranty of uninterrupted availability and accept no liability for business decisions made solely on demo data.",
    ],
  },
  {
    heading: "6. Changes to these terms",
    body: [
      "These terms may be updated as the Platform moves from prototype to production. Continued use after an update constitutes acceptance of the revised terms.",
    ],
  },
];

const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "1. What we collect",
    body: [
      "The Platform holds business contact data (names, emails, phone numbers, company affiliations), correspondence history, commercial records (quotations, orders, invoices) and, where provided, KYC/onboarding documents for customers and suppliers.",
    ],
  },
  {
    heading: "2. How data is used",
    body: [
      "Data is used solely to operate Renso Group's sales, sourcing, finance and compliance processes — including relationship scoring, pricing intelligence and reporting shown on this Platform.",
    ],
  },
  {
    heading: "3. Storage & retention",
    body: [
      "In this prototype, data is held client-side for the duration of the session and is not transmitted to a third-party server. A production deployment will define server-side storage location, retention periods and backup policy.",
    ],
  },
  {
    heading: "4. Third-party integrations",
    body: [
      "Where email, WhatsApp, accounting or mailing providers are connected in a future production version, data will only be shared with those providers as strictly necessary to deliver the integration, under their respective data processing terms.",
    ],
  },
  {
    heading: "5. Individual rights",
    body: [
      "Individuals whose data is held in the Platform may request access to, correction of, or deletion of their personal data, subject to Renso Group's legitimate business and legal record-keeping requirements.",
    ],
  },
  {
    heading: "6. Contact",
    body: [
      "Questions about this policy should be directed to Renso Group, 843 Finchley Rd, London NW11 8NA.",
    ],
  },
];


/**
 * Currency & trade settings.
 *
 * The rate table is the quiet foundation of the whole intelligence layer:
 * margin, credit exposure and the price index all convert through it. So the
 * panel is explicit about provenance — every rate carries the date it was
 * entered, rates over a month old are called out, and there is no "fetch live
 * rates" button, because there is no rate provider behind this build and a
 * button that invented a number would be worse than no button.
 */
function CurrencySettingsPanel({
  PanelShell,
  showToast,
}: {
  PanelShell: React.ComponentType<{ title: string; children: ReactNode }>;
  showToast: (msg: string) => void;
}) {
  const store = useStore();
  const [draft, setDraft] = useState(() =>
    store.fx.rates.map((r) => ({ currency: r.currency, value: String(r.perBase), asOf: r.asOf })),
  );
  const [newCurrency, setNewCurrency] = useState("");
  const [trade, setTrade] = useState(store.tradeSettings);
  const stale = staleRates(store.fx);

  const save = () => {
    const today = new Date().toISOString();
    const next = draft
      .filter((row) => row.currency.trim() && Number(row.value) > 0)
      .map((row) => {
        const existing = store.fx.rates.find((r) => r.currency === row.currency);
        const changed = !existing || existing.perBase !== Number(row.value);
        // Only a changed rate gets re-stamped. Re-dating every row on save
        // would make a stale table look fresh without anyone having checked it.
        return {
          currency: row.currency.trim().toUpperCase(),
          perBase: Number(row.value),
          asOf: changed ? today : existing!.asOf,
        };
      });
    store.updateFxRates(next);
    store.updateTradeSettings(trade);
    showToast("Rates and trade defaults saved");
  };

  return (
    <PanelShell title="Currency & trade">
      <div className="brand-card p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold text-ink">
            Reporting currency — {store.fx.base}
          </span>
          <span className="text-[12px] text-ink-tertiary">1 {store.fx.base} buys</span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          Every converted figure in the platform — margin, exposure, the price index —
          resolves through this table. A currency with no rate is reported in its own
          currency rather than assumed to be at parity.
        </p>

        {draft.map((row, index) => (
          <div key={row.currency} className="flex items-end gap-3">
            <div className="w-16 shrink-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                {row.currency}
              </span>
              <span className="block text-[11px] text-ink-tertiary">
                {shortDate(row.asOf)}
              </span>
            </div>
            <div className="flex-1">
              <TextInput
                value={row.value}
                inputMode="decimal"
                onChange={(e) =>
                  setDraft((prev) =>
                    prev.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)),
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              className="h-11 shrink-0 px-3 text-ink-tertiary"
              onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex items-end gap-3 border-t border-divider pt-3">
          <div className="flex-1">
            <Field label="Add a currency" hint="ISO code, e.g. CHF">
              <TextInput
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
                placeholder="CHF"
              />
            </Field>
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0 rounded-xl"
            onClick={() => {
              const code = newCurrency.trim().toUpperCase();
              if (!code || draft.some((r) => r.currency === code)) return;
              setDraft((prev) => [
                ...prev,
                { currency: code, value: "1", asOf: new Date().toISOString() },
              ]);
              setNewCurrency("");
            }}
          >
            Add
          </Button>
        </div>

        {stale.length ? (
          <p className="text-[13px] leading-relaxed" style={{ color: "rgb(var(--caution))" }}>
            {stale.map((r) => r.currency).join(", ")} last confirmed over a month ago. Every
            figure converted through those rates inherits that age, and the Signals page says so.
          </p>
        ) : null}
      </div>

      <div className="brand-card p-4 space-y-4">
        <span className="block text-[15px] font-semibold text-ink">Trade defaults</span>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          Starting assumptions for the landed-cost calculator on the Deal Desk. They are
          defaults, not rules — every deal can be modelled against its own freight and duty.
        </p>
        <Field label="Import duty, % of goods value">
          <TextInput
            value={String(trade.defaultDutyPct)}
            inputMode="decimal"
            onChange={(e) => setTrade({ ...trade, defaultDutyPct: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="Insurance, % of goods value">
          <TextInput
            value={String(trade.defaultInsurancePct)}
            inputMode="decimal"
            onChange={(e) =>
              setTrade({ ...trade, defaultInsurancePct: Number(e.target.value) || 0 })
            }
          />
        </Field>
        <Field label={`Typical freight per consignment (${trade.freightCurrency})`}>
          <TextInput
            value={String(trade.defaultFreightTotal)}
            inputMode="decimal"
            onChange={(e) =>
              setTrade({ ...trade, defaultFreightTotal: Number(e.target.value) || 0 })
            }
          />
        </Field>
        <Field label="Target margin, %" hint="Used by the price solver">
          <TextInput
            value={String(trade.targetMarginPct)}
            inputMode="decimal"
            onChange={(e) => setTrade({ ...trade, targetMarginPct: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field
          label="Price alert threshold, %"
          hint="A move smaller than this is not worth a signal"
        >
          <TextInput
            value={String(trade.priceAlertThresholdPct)}
            inputMode="decimal"
            onChange={(e) =>
              setTrade({ ...trade, priceAlertThresholdPct: Number(e.target.value) || 0 })
            }
          />
        </Field>
      </div>

      <Button className="h-11 w-full rounded-xl bg-accent" onClick={save}>
        Save
      </Button>
    </PanelShell>
  );
}

function SettingsPage() {
  const store = useStore();
  const { theme, toggle, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("sales");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  };

  const groups: {
    title: string;
    items: { id: string; label: string; sub: string; icon: React.ElementType; color: string }[];
  }[] = [
    {
      title: "Organisation",
      items: [
        { id: "org", label: "Organisation", sub: "Company profile, VAT, address", icon: Building2, color: "bg-accent" },
        { id: "users", label: "Users", sub: "Team members & access", icon: UserRound, color: "bg-accent" },
        { id: "roles", label: "Roles & Permissions", sub: "What each role can do", icon: KeyRound, color: "bg-[rgb(var(--tile-neutral))]" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { id: "crm", label: "CRM", sub: "Lead sources, segments, KYC rule", icon: Users, color: "bg-accent" },
        { id: "sales", label: "Sales", sub: "Numbering, terms, tax, approval", icon: TrendingUp, color: "bg-[rgb(var(--tile-neutral))]" },
        { id: "productsCfg", label: "Products", sub: "Categories, units, margin alert", icon: Package, color: "bg-accent" },
      ],
    },
    {
      title: "Communications",
      items: [
        { id: "email", label: "Email", sub: "Mailbox connection & history scan", icon: Mail, color: "bg-accent" },
        { id: "whatsapp", label: "WhatsApp", sub: "WhatsApp Business API", icon: MessageCircle, color: "bg-[rgb(var(--tile-neutral))]" },
        { id: "mailing", label: "Mass Mailing", sub: "Provider, segments, tracking", icon: Send, color: "bg-accent" },
      ],
    },
    {
      title: "Finance",
      items: [
        { id: "accounting", label: "Accounting", sub: "Xero / QuickBooks connector", icon: Wallet, color: "bg-accent" },
        { id: "invoicing", label: "Invoicing", sub: "Numbering, currency, terms", icon: FileText, color: "bg-[rgb(var(--tile-neutral))]" },
        { id: "currency", label: "Currency & trade", sub: "Rate table, duty, freight, margin target", icon: Coins, color: "bg-accent" },
      ],
    },
    {
      title: "Security",
      items: [
        { id: "audit", label: "Audit Log", sub: "Who changed what", icon: ScrollText, color: "bg-accent" },
        { id: "appearance", label: "Appearance", sub: "Theme & language", icon: Palette, color: "bg-[rgb(var(--tile-neutral))]" },
        { id: "data", label: "Data Management", sub: "Reset or reseed demo data", icon: Database, color: "bg-accent" },
      ],
    },
    {
      title: "Legal",
      items: [
        { id: "terms", label: "Terms & Conditions", sub: "Platform terms of use", icon: Scale, color: "bg-[rgb(var(--tile-neutral))]" },
        { id: "privacy", label: "Privacy Policy", sub: "Data handling & retention", icon: Lock, color: "bg-[rgb(var(--tile-neutral))]" },
      ],
    },
  ];

  const filtered = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          !query ||
          i.label.toLowerCase().includes(query.toLowerCase()) ||
          i.sub.toLowerCase().includes(query.toLowerCase()),
      ),
    }))
    .filter((g) => g.items.length > 0);

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5 border-b border-divider last:border-0">
      <span className="text-[15px] text-ink-secondary shrink-0">{label}</span>
      <span className="text-[15px] font-medium text-right text-ink">{value}</span>
    </div>
  );

  const PanelShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="max-w-2xl mx-auto space-y-5 pb-10">
      <BackLink label="Settings" onClick={() => setPanel(null)} />
      <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
      {children}
      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[rgb(var(--text-primary))] px-4 py-2 text-[13px] font-medium text-white shadow-lg lg:bottom-8">
          {toast}
        </div>
      ) : null}
    </div>
  );

  if (panel === "org") {
    return <OrganisationPanel PanelShell={PanelShell} showToast={showToast} />;
  }

  if (panel === "users") {
    const invite = () => {
      if (!newUserName.trim() || !newUserEmail.trim()) return;
      store.addUser({ name: newUserName.trim(), email: newUserEmail.trim(), role: newUserRole });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserRole("sales");
      setAddingUser(false);
      showToast("Team member invited (demo)");
    };

    return (
      <PanelShell title="Users">
        <div className="brand-card overflow-hidden divide-y divide-divider">
          {store.users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated text-[12px] font-semibold text-ink-secondary">
                {u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium truncate">
                  {u.name}{" "}
                  {u.id === store.user?.id ? (
                    <span className="text-ink-tertiary font-normal">(you)</span>
                  ) : null}
                  {!u.isActive ? (
                    <span className="ml-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-tertiary">
                      Inactive
                    </span>
                  ) : null}
                </div>
                <div className="text-[13px] text-ink-secondary truncate">{u.email}</div>
              </div>
              <select
                value={u.role}
                onChange={(e) => store.updateUser(u.id, { role: e.target.value as Role })}
                className="h-9 rounded-lg border border-divider bg-canvas px-2 text-[13px] font-medium text-ink-secondary outline-none focus:border-accent"
              >
                {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {u.id !== store.user?.id ? (
                <button
                  type="button"
                  onClick={() => store.updateUser(u.id, { isActive: !u.isActive })}
                  className="text-[13px] font-medium text-accent shrink-0"
                >
                  {u.isActive ? "Deactivate" : "Activate"}
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {addingUser ? (
          <div className="brand-card p-4 space-y-3">
            <Field label="Name" required>
              <TextInput value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Full name" />
            </Field>
            <Field label="Email" required>
              <TextInput value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Role">
              <SelectInput
                value={newUserRole}
                onChange={(v) => setNewUserRole(v as Role)}
                options={(Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setAddingUser(false)}>
                Cancel
              </Button>
              <Button className="flex-1 h-11 rounded-xl bg-accent" onClick={invite}>
                Send invite
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className="w-full h-12 rounded-full bg-accent text-white font-semibold"
            onClick={() => setAddingUser(true)}
          >
            Invite team member
          </Button>
        )}
      </PanelShell>
    );
  }

  if (panel === "roles") {
    const roles = [
      { role: "Administrator", perms: "Full access · integrations · users · audit" },
      { role: "Management", perms: "CRM · commercial · dashboard · export" },
      { role: "Commercial", perms: "Pricing · suppliers · AI review · products" },
      { role: "Sales", perms: "Customers · quotations · orders · pipeline" },
      { role: "Finance", perms: "Invoices · payments · accounting view" },
      { role: "Operations", perms: "Documents · KYC · fulfilment" },
      { role: "Read Only", perms: "View all · no edits · no send" },
    ];
    return (
      <PanelShell title="Roles & Permissions">
        <div className="brand-card overflow-hidden divide-y divide-divider">
          {roles.map((r) => (
            <div key={r.role} className="px-4 py-3.5">
              <div className="text-[15px] font-semibold">{r.role}</div>
              <div className="text-[13px] text-ink-secondary mt-0.5">{r.perms}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-tertiary">
          Reference only — <span className="font-semibold text-accent">not yet editable</span>. These are the
          platform's fixed roles; assign them to a user from Settings → Users. Changing what a role can do, or
          adding custom roles, needs server-side permission enforcement this client demo doesn't have yet.
        </p>
      </PanelShell>
    );
  }

  if (panel === "crm") {
    return <CrmSettingsPanel PanelShell={PanelShell} showToast={showToast} />;
  }

  if (panel === "sales") {
    return <SalesSettingsPanel PanelShell={PanelShell} showToast={showToast} />;
  }

  if (panel === "productsCfg") {
    return <ProductSettingsPanel PanelShell={PanelShell} showToast={showToast} />;
  }

  if (panel === "currency") {
    return <CurrencySettingsPanel PanelShell={PanelShell} showToast={showToast} />;
  }

  if (panel === "email") {
    return (
      <PanelShell title="Email">
        <div className="brand-card overflow-hidden">
          <Row label="Provider" value="IMAP / Microsoft Graph" />
          <Row
            label="Status"
            value={<span className="text-accent font-semibold">NOT CONNECTED</span>}
          />
          <Row label="History rule" value="Received only · rolling 18 months" />
          <Row label="Mailbox" value="— configure credentials" />
        </div>
        <div className="flex flex-col gap-2">
          <Button
            className="h-11 rounded-xl bg-accent"
            onClick={() => showToast("Connect flow opens when credentials are set")}
          >
            Connect mailbox
          </Button>
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => {
              const res = store.runHistoricalEmailScan();
              setScanMsg(res.message);
              showToast(res.message);
            }}
          >
            Run historical scan (demo data)
          </Button>
        </div>
        {scanMsg ? (
          <div className="brand-card p-4 text-[14px] text-ink-secondary leading-relaxed">
            {scanMsg}
          </div>
        ) : null}
        <p className="text-[13px] text-ink-tertiary">
          Scan creates/updates contacts and companies from realistic sample messages. Live mailbox requires provider credentials in production.
        </p>
      </PanelShell>
    );
  }

  if (panel === "whatsapp") {
    return (
      <PanelShell title="WhatsApp">
        <div className="brand-card overflow-hidden">
          <Row label="API" value="WhatsApp Business" />
          <Row label="Status" value={<span className="text-accent font-semibold">NOT CONNECTED</span>} />
          <Row label="Extraction" value="Quotes & offers → AI review queue" />
        </div>
        <Button
          className="w-full h-12 rounded-full bg-accent text-white font-semibold"
          onClick={() => showToast("WhatsApp Business OAuth not configured")}
        >
          Connect WhatsApp
        </Button>
      </PanelShell>
    );
  }

  if (panel === "mailing") {
    return (
      <PanelShell title="Mass Mailing">
        <div className="brand-card overflow-hidden">
          <Row label="Provider" value="Provider-agnostic" />
          <Row label="Status" value={<span className="text-accent font-semibold">NOT CONNECTED</span>} />
          <Row label="Segments" value="By customer type, score, region" />
          <Row label="Tracking" value="Sent / opened when provider supports it" />
        </div>
        <Button
          className="w-full h-12 rounded-full bg-accent text-white font-semibold"
          onClick={() => showToast("Connect mailing provider in production")}
        >
          Configure provider
        </Button>
      </PanelShell>
    );
  }

  if (panel === "accounting") {
    const sales = store.invoices.reduce((s, i) => s + i.total, 0);
    const paid = store.invoices
      .filter((i) => i.status === "paid")
      .reduce((s, i) => s + (i.amountPaid || i.total), 0);
    return (
      <PanelShell title="Accounting">
        <div className="grid grid-cols-2 gap-3">
          <div className="brand-card p-4">
            <div className="text-[12px] text-ink-secondary">Invoiced (CRM)</div>
            <div className="renso-metric text-[22px] font-semibold mt-1">{formatMoney(sales)}</div>
          </div>
          <div className="brand-card p-4">
            <div className="text-[12px] text-ink-secondary">Received</div>
            <div className="renso-metric text-[22px] font-semibold mt-1">{formatMoney(paid)}</div>
          </div>
        </div>
        <div className="brand-card overflow-hidden">
          <Row label="External connector" value="Xero-ready · QuickBooks-ready" />
          <Row label="Status" value={<span className="text-accent font-semibold">NOT CONNECTED</span>} />
          <Row label="Internal ledger" value="Linked to invoices & orders" />
        </div>
        <Button
          className="w-full h-12 rounded-full bg-accent text-white font-semibold"
          onClick={() => showToast("OAuth connector not configured in demo")}
        >
          Connect Xero
        </Button>
      </PanelShell>
    );
  }

  if (panel === "invoicing") {
    return (
      <PanelShell title="Invoicing">
        <div className="brand-card overflow-hidden">
          <Row label="Number series" value="INV-2026-####" />
          <Row label="Default currency" value="GBP (customer override)" />
          <Row label="Payment terms" value="30 days" />
          <Row label="Tax" value="As per customer / jurisdiction" />
          <Row label="From orders" value="One-click convert keeps line items" />
          <Row label="Dashboard" value="Totals feed revenue & profit" />
        </div>
        <p className="text-[13px] text-ink-tertiary">
          These are the defaults currently in effect, shown here for reference —{" "}
          <span className="font-semibold text-accent">not yet editable</span> from this panel. Create and manage
          individual invoices under Sales → Invoices; making numbering and terms configurable here is a small
          follow-up, not yet built.
        </p>
      </PanelShell>
    );
  }

  if (panel === "audit") {
    const events = [
      { who: "Roni Ornadel", what: "Approved pricing record", when: "Sample entry · AI review" },
      { who: "System", what: "Historical email scan completed", when: "Sample entry · demo seed" },
      { who: "Roni Ornadel", what: "Converted quotation → order", when: "Sample entry · sales pipeline" },
      { who: "Roni Ornadel", what: "Signed in", when: "Sample entry · this session" },
    ];
    return (
      <PanelShell title="Audit Log">
        <div className="brand-card overflow-hidden divide-y divide-divider">
          {events.map((e, i) => (
            <div key={i} className="px-4 py-3.5">
              <div className="text-[15px] font-medium">{e.what}</div>
              <div className="text-[13px] text-ink-secondary mt-0.5">
                {e.who} · {e.when}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[13px] text-ink-tertiary">
          Production persists actor, entity, previous/new values and timestamp for every sensitive action.
        </p>
      </PanelShell>
    );
  }

  if (panel === "appearance") {
    return (
      <PanelShell title="Appearance">
        <div className="brand-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-divider">
            <div>
              <div className="text-[15px] font-medium">Theme</div>
              <div className="text-[13px] text-ink-secondary">Light or dark across the app</div>
            </div>
            <div className="flex rounded-full bg-elevated p-1">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                  theme === "light" ? "bg-surface shadow-sm text-ink" : "text-ink-secondary"
                }`}
              >
                Light
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                  theme === "dark" ? "bg-surface shadow-sm text-ink" : "text-ink-secondary"
                }`}
              >
                Dark
              </button>
            </div>
          </div>
          <Row label="Language" value="English" />
          <Row label="Brand" value="Renso navy · no gold" />
        </div>
        <Button variant="outline" className="w-full h-11 rounded-xl" onClick={toggle}>
          Toggle theme now
        </Button>
      </PanelShell>
    );
  }

  if (panel === "data") {
    return (
      <PanelShell title="Data Management">
        <div className="brand-card overflow-hidden">
          <Row label="Customers" value={String(store.customers.length)} />
          <Row label="Suppliers" value={String(store.suppliers.length)} />
          <Row label="Products" value={String(store.products.length)} />
          <Row label="Pricing records" value={String(store.pricingRecords.length)} />
          <Row label="Invoices" value={String(store.invoices.length)} />
          <Row label="Documents" value={String(store.documents.length)} />
        </div>
        <Button
          variant="outline"
          className="w-full h-11 rounded-xl"
          onClick={() => {
            const snapshot = {
              exportedAt: new Date().toISOString(),
              customers: store.customers,
              suppliers: store.suppliers,
              products: store.products,
              pricing: store.pricingRecords,
              quotations: store.quotations,
              orders: store.orders,
              invoices: store.invoices,
              contacts: store.contacts,
              documents: store.documents,
            };
            downloadText(
              `renso-crm-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(snapshot, null, 2),
              "application/json",
            );
            showToast("CRM snapshot downloaded");
          }}
        >
          Export CRM snapshot
        </Button>
        <Button
          className="w-full h-11 rounded-xl bg-elevated text-ink hover:bg-canvas border border-divider"
          onClick={() => {
            if (window.confirm("Reload the app to reset demo session state?")) {
              window.location.reload();
            }
          }}
        >
          Reset demo session
        </Button>
        <p className="text-[13px] text-ink-tertiary">
          Demo data is seeded in memory. Clearing site data for this origin fully reseeds on next load.
        </p>
      </PanelShell>
    );
  }

  if (panel === "terms") {
    return (
      <PanelShell title="Terms & Conditions">
        <LegalDocument sections={TERMS_SECTIONS} />
      </PanelShell>
    );
  }

  if (panel === "privacy") {
    return (
      <PanelShell title="Privacy Policy">
        <LegalDocument sections={PRIVACY_SECTIONS} />
      </PanelShell>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[15px] text-ink-secondary mt-1">
          Manage Renso Group — organisation, access, integrations & data
        </p>
      </div>

      <div className="brand-card flex items-center gap-3.5 px-4 py-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-ink-secondary">
          RO
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold tracking-tight">
            {store.user?.name || "Roni Ornadel"}
          </div>
          <div className="text-[13px] text-ink-secondary">
            Administrator · Renso Group
          </div>
        </div>
        <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
          Demo
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings"
          className="h-11 w-full rounded-xl border-0 bg-surface pl-10 pr-4 text-[15px] shadow-sm ring-1 ring-divider placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]/30"
        />
      </div>

      {filtered.map((group) => (
        <div key={group.title}>
          <div className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-tertiary">
            {group.title}
          </div>
          <div className="brand-card overflow-hidden divide-y divide-divider">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPanel(item.id)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-elevated/60 active:bg-elevated"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white ${item.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-medium tracking-tight">{item.label}</div>
                    <div className="text-[13px] text-ink-secondary truncate">{item.sub}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => store.signOut()}
        className="w-full brand-card py-3.5 text-[16px] font-medium text-ink-secondary hover:bg-elevated"
      >
        Sign out
      </button>

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[rgb(var(--text-primary))] px-4 py-2 text-[13px] font-medium text-white shadow-lg lg:bottom-8">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ContactsPage() {
  const store = useStore();
  const { contacts, customers, suppliers } = store;
  const [adding, setAdding] = useState(false);
  const emptyForm = {
    firstName: "", lastName: "", jobTitle: "", email: "", phone: "", whatsapp: "",
    linkedId: "", isPrimary: false, notes: "",
  };
  const [cf, setCf] = useState(emptyForm);
  const setCF = (k: keyof typeof emptyForm, v: string | boolean) => setCf((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!cf.firstName.trim() || !cf.lastName.trim()) return;
    const isCustomer = customers.some((x) => x.id === cf.linkedId);
    store.addContact({
      firstName: cf.firstName.trim(),
      lastName: cf.lastName.trim(),
      email: cf.email.trim() || undefined,
      phone: cf.phone.trim() || undefined,
      whatsapp: cf.whatsapp.trim() || undefined,
      jobTitle: cf.jobTitle.trim() || undefined,
      isPrimary: cf.isPrimary,
      notes: cf.notes || undefined,
      customerId: isCustomer ? cf.linkedId : undefined,
      supplierId: isCustomer || !cf.linkedId ? undefined : cf.linkedId,
    });
    setCf(emptyForm);
    setAdding(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-ink">Contacts</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            {contacts.length} people linked to customers and suppliers
          </p>
        </div>
        <Button className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm" onClick={() => setAdding((value) => !value)}>
          {adding ? "Cancel" : "Add contact"}
        </Button>
      </div>
      {adding ? (
        <div className="space-y-4">
          <FormSection title="Person">
            <Field label="First name" required>
              <TextInput value={cf.firstName} onChange={(e) => setCF("firstName", e.target.value)} autoFocus />
            </Field>
            <Field label="Last name" required>
              <TextInput value={cf.lastName} onChange={(e) => setCF("lastName", e.target.value)} />
            </Field>
            <Field label="Job title">
              <TextInput value={cf.jobTitle} onChange={(e) => setCF("jobTitle", e.target.value)} placeholder="e.g. Procurement Manager" />
            </Field>
            <Field label="Linked organisation">
              <SelectInput
                value={cf.linkedId}
                onChange={(v) => setCF("linkedId", v)}
                options={[
                  { value: "", label: "No linked organisation" },
                  ...customers.map((c) => ({ value: c.id, label: `${c.name} (customer)` })),
                  ...suppliers.map((s) => ({ value: s.id, label: `${s.name} (supplier)` })),
                ]}
              />
            </Field>
          </FormSection>
          <FormSection title="Contact details">
            <Field label="Email">
              <TextInput type="email" value={cf.email} onChange={(e) => setCF("email", e.target.value)} placeholder="name@company.com" />
            </Field>
            <Field label="Phone">
              <TextInput type="tel" value={cf.phone} onChange={(e) => setCF("phone", e.target.value)} placeholder="+44…" />
            </Field>
            <Field label="WhatsApp">
              <TextInput type="tel" value={cf.whatsapp} onChange={(e) => setCF("whatsapp", e.target.value)} placeholder="+44…" />
            </Field>
            <Field label="Primary contact">
              <label className="flex h-11 items-center gap-2.5 rounded-control border border-divider bg-canvas px-3 text-[14px] text-ink cursor-pointer">
                <input type="checkbox" checked={cf.isPrimary} onChange={(e) => setCF("isPrimary", e.target.checked)} className="h-4 w-4 rounded border-divider accent-[rgb(var(--accent))]" />
                Mark as primary contact for this organisation
              </label>
            </Field>
          </FormSection>
          <FormSection title="Notes" cols={1}>
            <Field label="Internal notes">
              <TextArea value={cf.notes} onChange={(e) => setCF("notes", e.target.value)} placeholder="Preferences, relationship context…" />
            </Field>
          </FormSection>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-full px-5 text-[14px] font-semibold text-ink-secondary hover:bg-elevated">Cancel</button>
            <Button className="h-11 rounded-full bg-accent px-6 text-white font-semibold" onClick={save} disabled={!cf.firstName.trim() || !cf.lastName.trim()}>
              Save contact
            </Button>
          </div>
        </div>
      ) : null}
      <div className="brand-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-divider text-left text-xs text-ink-secondary">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium hidden sm:table-cell">Role</th>
              <th className="px-5 py-3 font-medium">Linked to</th>
              <th className="px-5 py-3 font-medium hidden md:table-cell">Email</th>
              <th className="px-5 py-3 font-medium hidden lg:table-cell">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {contacts.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-[13px] text-ink-secondary">No contacts yet. Add the people you deal with at each customer and supplier.</td></tr>
            ) : contacts.map((c) => {
              const linked =
                customers.find((x) => x.id === c.customerId)?.name ||
                suppliers.find((x) => x.id === c.supplierId)?.name ||
                "—";
              return (
                <tr key={c.id} className="hover:bg-elevated/50">
                  <td className="px-5 py-3.5">
                    <div className="font-medium">
                      {c.firstName} {c.lastName}
                      {c.isPrimary && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-accent font-semibold">
                          Primary
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-tertiary sm:hidden">
                      {c.jobTitle}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell text-ink-secondary">
                    {c.jobTitle || "—"}
                  </td>
                  <td className="px-5 py-3.5">{linked}</td>
                  <td className="px-5 py-3.5 hidden md:table-cell text-ink-secondary">
                    {c.email || "—"}
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell text-ink-secondary">
                    {c.phone || c.whatsapp || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DOCUMENT_TYPE_OPTIONS = [
  { value: "contract", label: "Contract" },
  { value: "quotation", label: "Quotation" },
  { value: "order", label: "Order" },
  { value: "invoice", label: "Invoice" },
  { value: "kyc", label: "KYC" },
  { value: "certificate", label: "Certificate" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
];

/** Small coloured pill describing where a document sits in its lifecycle. */
/**
 * Expiry badge.
 *
 * Rebuilt on the shared iOS pill. The previous version used a saturated orange
 * for anything inside the warning window, which is not a colour Apple uses for
 * a countdown and which made three documents that are merely *approaching*
 * renewal shout louder than the one that has actually lapsed. Now: neutral
 * while there's time, a muted caution inside the window, red only once it has
 * genuinely expired.
 */
function ExpiryBadge({ info }: { info: ExpiryInfo }) {
  if (info.state === "none") {
    return <span className="text-[12px] text-ink-tertiary">No expiry</span>;
  }
  const tone: PillTone =
    info.state === "expired" ? "danger" : info.state === "expiring" ? "caution" : "success";
  const Icon = info.state === "expired" ? AlertCircle : info.state === "expiring" ? Clock : undefined;
  return (
    <Pill tone={tone} icon={Icon}>
      {expiryLabel(info)}
    </Pill>
  );
}

function DocumentsPage() {
  const store = useStore();
  const warningDays = store.crmSettings.documentExpiryWarningDays ?? 30;
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention" | "tracked">("all");
  const emptyForm = {
    name: "",
    type: "contract",
    reference: "",
    linkId: "",
    issuedAt: "",
    expiresAt: "",
  };
  const [form, setForm] = useState(emptyForm);
  const setF = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // A single picker covering both sides of the book; the prefix says which
  // foreign key the id belongs to.
  const linkOptions = [
    { value: "", label: "Not linked" },
    ...store.customers.map((c) => ({ value: `c:${c.id}`, label: `Customer — ${c.name}` })),
    ...store.suppliers.map((s) => ({ value: `s:${s.id}`, label: `Supplier — ${s.name}` })),
  ];

  const save = () => {
    if (!form.name.trim()) return;
    const [kind, id] = form.linkId ? form.linkId.split(":") : ["", ""];
    store.addDocument({
      name: form.name.trim(),
      type: form.type as Document["type"],
      reference: form.reference.trim() || undefined,
      customerId: kind === "c" ? id : undefined,
      supplierId: kind === "s" ? id : undefined,
      issuedAt: form.issuedAt ? new Date(form.issuedAt).toISOString() : undefined,
      expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      source: "upload",
    });
    setForm(emptyForm);
    setAdding(false);
  };

  const attention = documentsNeedingAttention(store.documents, warningDays);
  const expiredCount = attention.filter((a) => a.expiry.state === "expired").length;
  const expiringCount = attention.length - expiredCount;

  const visible = store.documents.filter((d) => {
    if (filter === "all") return true;
    const state = documentExpiry(d, warningDays).state;
    if (filter === "tracked") return state !== "none";
    return state === "expired" || state === "expiring";
  });

  // Surface the urgent ones first; within the same state, soonest first.
  const ordered = visible
    .slice()
    .sort((a, b) => {
      const order: Record<ExpiryState, number> = { expired: 0, expiring: 1, valid: 2, none: 3 };
      const ea = documentExpiry(a, warningDays);
      const eb = documentExpiry(b, warningDays);
      if (order[ea.state] !== order[eb.state]) return order[ea.state] - order[eb.state];
      return (ea.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (eb.daysRemaining ?? Number.MAX_SAFE_INTEGER);
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Documents</h1>
          <p className="text-[14px] text-ink-secondary mt-1">
            Contracts · KYC · certificates · expiry tracking
          </p>
        </div>
        <Button
          className="h-11 rounded-full bg-accent text-white font-semibold shadow-sm"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Cancel" : "Add document"}
        </Button>
      </div>

      {attention.length > 0 ? (
        <div className="brand-card border-l-4 border-l-accent p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-ink">
                {expiredCount > 0
                  ? `${expiredCount} document${expiredCount === 1 ? "" : "s"} expired`
                  : "Documents approaching expiry"}
                {expiredCount > 0 && expiringCount > 0 ? ` · ${expiringCount} expiring soon` : ""}
              </div>
              <p className="mt-0.5 text-[12px] text-ink-secondary">
                Within the {warningDays}-day warning window set in Settings → CRM.{" "}
                {attention
                  .slice(0, 3)
                  .map((a) => a.document.name)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {adding ? (
        <div className="space-y-4">
          <FormSection
            title="Document"
            description="Expiry is optional — leave it blank for anything that does not lapse."
          >
            <Field label="Name" required full>
              <TextInput
                value={form.name}
                onChange={(e) => setF("name", e.target.value)}
                placeholder="e.g. ISO 9001 Certificate.pdf"
                autoFocus
              />
            </Field>
            <Field label="Type">
              <SelectInput value={form.type} onChange={(v) => setF("type", v)} options={DOCUMENT_TYPE_OPTIONS} />
            </Field>
            <Field label="Issuer reference" hint="Certificate, contract or policy number">
              <TextInput
                value={form.reference}
                onChange={(e) => setF("reference", e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Linked to" full>
              <SelectInput value={form.linkId} onChange={(v) => setF("linkId", v)} options={linkOptions} />
            </Field>
            <Field label="Issued">
              <TextInput type="date" value={form.issuedAt} onChange={(e) => setF("issuedAt", e.target.value)} />
            </Field>
            <Field label="Expires">
              <TextInput type="date" value={form.expiresAt} onChange={(e) => setF("expiresAt", e.target.value)} />
            </Field>
          </FormSection>
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton onClick={save} disabled={!form.name.trim()}>
              Save document
            </PrimaryButton>
            <Button variant="outline" className="h-12 rounded-full" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[12px] text-ink-tertiary">
            File storage requires a backend; this records the document's metadata and expiry.
          </p>
        </div>
      ) : null}

      <SegmentedControl
        value={filter}
        onChange={(v) => setFilter(v as "all" | "attention" | "tracked")}
        options={[
          { id: "all", label: `All · ${store.documents.length}` },
          { id: "tracked", label: "With expiry" },
          { id: "attention", label: `Needs attention · ${attention.length}` },
        ]}
      />

      <div className="brand-card overflow-hidden divide-y divide-divider">
        {ordered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-ink-secondary">
            {store.documents.length === 0 ? "No documents yet." : "Nothing matches this filter."}
          </div>
        ) : (
          ordered.map((d) => {
            const linked =
              store.customers.find((c) => c.id === d.customerId)?.name ||
              store.suppliers.find((s) => s.id === d.supplierId)?.name ||
              "Unlinked";
            const info = documentExpiry(d, warningDays);
            return (
              <div key={d.id} className="px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium truncate">{d.name}</div>
                  <div className="text-[13px] text-ink-secondary capitalize">
                    {d.type} · {linked}
                    {d.reference ? ` · ${d.reference}` : ""}
                    {d.expiresAt ? ` · expires ${shortDate(d.expiresAt)}` : ""}
                  </div>
                </div>
                <ExpiryBadge info={info} />
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    aria-label={`Expiry date for ${d.name}`}
                    value={d.expiresAt ? d.expiresAt.slice(0, 10) : ""}
                    onChange={(e) =>
                      store.updateDocument(d.id, {
                        expiresAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      })
                    }
                    className={cn(inputClass, "h-9 w-[150px] text-[13px]")}
                  />
                  <button
                    type="button"
                    className="text-[13px] font-medium text-ink-secondary hover:text-ink"
                    onClick={() => {
                      if (window.confirm("Remove document?")) store.removeDocument(d.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ScoringPage() {
  const { customers, suppliers, invoices, orders, pricingRecords, payments, deliveries, products } =
    useStore();
  const [openId, setOpenId] = useState<string | null>(null);

  // Passing receipts and despatches in switches both sides of the ranking from
  // typed-in estimates to measured behaviour, where there is enough history.
  const customerScores = scoreCustomers(customers, invoices, orders, payments);
  const supplierScores = scoreSuppliers(suppliers, pricingRecords, {
    orders,
    deliveries,
    products,
  });

  const rankedCustomers = [...customers].sort(
    (a, b) => (customerScores[b.id]?.score || 0) - (customerScores[a.id]?.score || 0),
  );
  const rankedSuppliers = [...suppliers].sort(
    (a, b) => (supplierScores[b.id]?.score || 0) - (supplierScores[a.id]?.score || 0),
  );

  const ComponentBreakdown = ({ entry }: { entry: ScoreComponents | undefined }) => {
    if (!entry) return null;
    return (
      <div className="px-5 pb-4 pt-1 space-y-2 bg-elevated/40">
        {entry.components.map((comp) => (
          <div key={comp.label} className="flex items-center gap-3 text-xs">
            <span className="w-40 shrink-0 text-ink-secondary">
              {comp.label} <span className="text-ink-tertiary">({comp.weightPct}%)</span>
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-divider overflow-hidden">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(0, Math.min(100, comp.value))}%` }}
              />
            </div>
            <span className="w-8 text-right tabular-nums font-medium text-ink">{comp.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Relationship Scoring</h1>
        <p className="text-[15px] text-ink-secondary mt-1">
          Ranked by value and reliability — not volume alone
        </p>
      </div>
      <div className="rounded-2xl border border-divider bg-elevated/50 p-4 text-[13px] text-ink-secondary leading-relaxed">
        <span className="font-semibold text-ink">v1 formula</span> · computed live from invoices, orders
        and pricing records — not a stored label. Click a row to see the components behind its score.
        <br />
        Customer: 35% revenue · 20% order frequency · 15% AOV · 15% recency · 15% payment reliability.
        Supplier: 30% spend · 20% orders · 25% price competitiveness · 15% delivery · 10% terms.
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="brand-card overflow-hidden">
          <div className="px-5 py-4 border-b border-divider font-semibold text-sm">
            Top customers
          </div>
          <div className="divide-y divide-divider">
            {rankedCustomers.map((c, i) => (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === c.id ? null : c.id)}
                  className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-elevated/60 transition-colors"
                >
                  <span className="w-6 text-[13px] font-semibold text-ink-tertiary tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.name}</div>
                    <div className="text-xs text-ink-tertiary">
                      {c.totalOrders || 0} orders · {formatMoney(c.totalRevenue || 0, c.currency)}
                    </div>
                  </div>
                  <span className="text-lg font-semibold tabular-nums text-accent">
                    {customerScores[c.id]?.score ?? "—"}
                  </span>
                  <ChevronRight className={cn("w-4 h-4 text-ink-tertiary transition-transform", openId === c.id && "rotate-90")} />
                </button>
                {openId === c.id ? <ComponentBreakdown entry={customerScores[c.id]} /> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="brand-card overflow-hidden">
          <div className="px-5 py-4 border-b border-divider font-semibold text-sm">
            Top suppliers
          </div>
          <div className="divide-y divide-divider">
            {rankedSuppliers.map((s, i) => (
              <div key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(openId === s.id ? null : s.id)}
                  className="w-full px-5 py-3.5 flex items-center gap-4 text-left hover:bg-elevated/60 transition-colors"
                >
                  <span className="w-6 text-[13px] font-semibold text-ink-tertiary tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{s.name}</div>
                    <div className="text-xs text-ink-tertiary">
                      Spend {formatMoney(s.totalSpend || 0, s.currency)} · Delivery {s.deliveryPerformance ?? "—"}%
                    </div>
                  </div>
                  <span className="text-lg font-semibold tabular-nums text-accent">
                    {supplierScores[s.id]?.score ?? "—"}
                  </span>
                  <ChevronRight className={cn("w-4 h-4 text-ink-tertiary transition-transform", openId === s.id && "rotate-90")} />
                </button>
                {openId === s.id ? <ComponentBreakdown entry={supplierScores[s.id]} /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Payments — the cash view, kept deliberately separate from Accounting.
 *
 * Accounting reports on an accruals basis because that is what a filing needs;
 * this is what actually moved through the bank. Blending the two is how a
 * business talks itself into thinking it has money it hasn't collected.
 */
function PaymentsPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [allocating, setAllocating] = useState<string | null>(null);
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");

  const received = store.payments.filter((p) => p.direction === "in");
  const paidOut = store.payments.filter((p) => p.direction === "out");
  const totalIn = received.reduce((s, p) => s + p.amount, 0);
  const totalOut = paidOut.reduce((s, p) => s + p.amount, 0);

  const openInvoices = store.invoices.filter((i) => {
    if (i.status === "cancelled" || i.status === "draft") return false;
    const paid = i.amountPaid ?? (i.status === "paid" ? i.total : 0);
    return i.total - paid > 0.01;
  });

  const rows = store.payments.filter((p) => direction === "all" || p.direction === direction);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[34px] font-semibold leading-none tracking-tight text-ink">Payments</h1>
        <p className="mt-2 text-[14px] text-ink-secondary">
          Cash actually received and paid out, allocated against invoices and expenses.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="brand-card p-5">
          <div className="text-[12px] text-ink-secondary">Received</div>
          <div className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            {formatMoney(totalIn)}
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-tertiary">{received.length} receipts</div>
        </div>
        <div className="brand-card p-5">
          <div className="text-[12px] text-ink-secondary">Paid out</div>
          <div className="mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink">
            {formatMoney(totalOut)}
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-tertiary">{paidOut.length} payments</div>
        </div>
        <div className="brand-card p-5">
          <div className="text-[12px] text-ink-secondary">Net movement</div>
          <div
            className={cn(
              "mt-1.5 text-[24px] font-semibold leading-none tabular-nums tracking-tight",
              totalIn - totalOut >= 0 ? "text-ink" : "text-accent",
            )}
          >
            {formatMoney(totalIn - totalOut)}
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-tertiary">Not currency-converted</div>
        </div>
      </div>

      {openInvoices.length ? (
        <div className="brand-card overflow-hidden">
          <div className="border-b border-divider px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-ink">Awaiting payment</h2>
            <p className="mt-0.5 text-[12px] text-ink-tertiary">
              Record a receipt here and the invoice status updates in the same step.
            </p>
          </div>
          <div className="divide-y divide-divider">
            {openInvoices.map((inv) => {
              const customer = store.customers.find((c) => c.id === inv.customerId);
              const paid = inv.amountPaid ?? 0;
              const balance = inv.total - paid;
              return (
                <div key={inv.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => onOpenRecord("invoices", inv.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="font-mono text-[13.5px] font-semibold text-ink">{inv.number}</div>
                    <div className="truncate text-[12.5px] text-ink-secondary">
                      {customer?.name || "—"}
                      {paid > 0 ? ` · ${formatMoney(paid, inv.currency)} received so far` : ""}
                    </div>
                  </button>
                  <div className="text-right sm:w-[130px]">
                    <div className="text-[14px] font-semibold tabular-nums text-ink">
                      {formatMoney(balance, inv.currency)}
                    </div>
                    <div className="text-[11.5px] text-ink-tertiary">outstanding</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllocating(inv.id)}
                    className="brand-focus h-9 shrink-0 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white"
                  >
                    Record receipt
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="w-[300px]">
          <SegmentedControl
            value={direction}
            onChange={(v) => setDirection(v as typeof direction)}
            options={[
              { id: "all", label: "All" },
              { id: "in", label: "Received" },
              { id: "out", label: "Paid out" },
            ]}
          />
        </div>
      </div>

      <div className="brand-card divide-y divide-divider overflow-hidden">
        {rows.map((p) => {
          const invoice = store.invoices.find((i) => i.id === p.invoiceId);
          const customer = store.customers.find((c) => c.id === p.customerId);
          const supplier = store.suppliers.find((sp) => sp.id === p.supplierId);
          const expense = store.expenses.find((e) => e.id === p.expenseId);
          const isIn = p.direction === "in";
          return (
            <div key={p.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                  isIn ? "bg-success/10 text-success" : "bg-accent/10 text-accent",
                )}
              >
                {isIn ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">
                  {customer?.name || supplier?.name || expense?.supplierName || "Bank movement"}
                </div>
                <div className="truncate text-[12.5px] text-ink-secondary">
                  {invoice ? invoice.number : expense ? expense.description : "—"}
                  {p.reference ? ` · ${p.reference}` : ""} · {relativeDay(p.paidAt)}
                </div>
                {p.notes ? (
                  <div className="mt-0.5 truncate text-[11.5px] text-ink-tertiary">{p.notes}</div>
                ) : null}
              </div>
              <div className="text-right sm:w-[140px]">
                <div
                  className={cn(
                    "text-[14px] font-semibold tabular-nums",
                    isIn ? "text-success" : "text-ink",
                  )}
                >
                  {isIn ? "+" : "−"} {formatMoney(p.amount, p.currency)}
                </div>
                <div className="text-[11.5px] capitalize text-ink-tertiary">
                  {(p.method ?? "bank_transfer").replace(/_/g, " ")}
                </div>
              </div>
              {invoice ? (
                <button
                  type="button"
                  onClick={() => onOpenRecord("invoices", invoice.id)}
                  className="shrink-0 text-[12.5px] font-semibold text-accent"
                >
                  Open
                </button>
              ) : null}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-secondary">
            No payments recorded yet.
          </p>
        ) : null}
      </div>

      {allocating ? (
        <ReceiptForm invoiceId={allocating} onClose={() => setAllocating(null)} />
      ) : null}
    </div>
  );
}

function ReceiptForm({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const store = useStore();
  const invoice = store.invoices.find((i) => i.id === invoiceId);
  const balance = invoice ? invoice.total - (invoice.amountPaid ?? 0) : 0;
  const [amount, setAmount] = useState(String(balance.toFixed(2)));
  const [method, setMethod] = useState<"bank_transfer" | "card" | "cash" | "cheque" | "other">("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));

  if (!invoice) return null;
  const value = Number(amount);
  const valid = value > 0 && value <= balance + 0.01;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl border border-divider bg-surface sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-divider px-5 py-3.5">
          <h3 className="text-[15px] font-semibold text-ink">Record receipt</h3>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">
            {invoice.number} · {formatMoney(balance, invoice.currency)} outstanding
          </p>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
              Amount ({invoice.currency})
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
            {!valid && value > balance ? (
              <p className="mt-1.5 text-[12px] text-accent">
                More than the outstanding balance — record the excess as a separate credit instead.
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Method
              </div>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className={inputClass + " appearance-none"}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Date
              </div>
              <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
              Bank reference
            </div>
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div className="flex gap-2 border-t border-divider px-5 py-3.5">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              store.recordReceipt({
                invoiceId,
                amount: value,
                method,
                reference: reference.trim() || undefined,
                paidAt: new Date(paidAt).toISOString(),
              });
              onClose();
            }}
            className={cn(
              "brand-focus h-10 flex-1 rounded-full text-[14px] font-semibold",
              valid ? "bg-accent text-white" : "cursor-not-allowed bg-elevated text-ink-tertiary",
            )}
          >
            Record {formatMoney(value || 0, invoice.currency)}
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

function EmptyModule({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-5 max-w-xl animate-rise">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-ink">{title}</h1>
        <AccentRule className="mt-2" />
      </div>
      <EmptyState title={title} description={message} />
    </div>
  );
}
