/**
 * Requirements · KYC · Portfolio.
 *
 * All three were single-card pages: a title, one row, no stats, no detail view
 * and no way to get from the record to anything else. That is the "generic"
 * Roni is reacting to — not the colours, but the fact that each page was a
 * dead end.
 *
 * Rebuilt on the shared iOS kit so they match the rest of the app, and, more
 * importantly, wired to the records either side of them:
 *   · a requirement now resolves live supplier offers and drafts a quotation
 *   · a KYC case now shows its document checklist and gates the customer
 *   · the portfolio now shows the price spread per product and lets you choose
 *     what goes on the price list before exporting it
 */
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Package,
  Plus,
  Receipt,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  BackLink,
  Button,
  EmptyState,
  FieldRow,
  Group,
  PageHeader,
  Pill,
  ProgressBar,
  RelatedPanel,
  Row,
  SearchField,
  SectionLabel,
  Segmented,
  Sheet,
  StatRow,
  StatTile,
  StatusPill,
  expiryTone,
} from "@/components/ios";
import { useStore } from "@/lib/store";
import type { CustomerRequirement, PricingRecord, Product } from "@/lib/domain";
import type { AppSection } from "@/components/Shell";

function money(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function wholeMoney(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

function shortDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const inputClass =
  "h-10 w-full rounded-[10px] border border-divider bg-canvas px-3 text-[14px] text-ink outline-none focus:border-accent";

/* ========================================================================== */
/* Requirements                                                               */
/* ========================================================================== */

/**
 * Requirement 5 in Roni's list: search a product and see every price received
 * for it, with supplier, date and source. That lives here, because a
 * requirement is the moment you actually need it.
 */
export function RequirementsPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all" | "closed">("open");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = store.requirements.find((r) => r.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const open = store.requirements.filter(
      (r) => !["won", "lost", "cancelled"].includes(r.status),
    );
    const unmatched = open.filter((r) => (r.matchedSupplierIds || []).length === 0);
    const quoted = store.requirements.filter((r) => r.status === "quoted");
    return { open: open.length, unmatched: unmatched.length, quoted: quoted.length };
  }, [store.requirements]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.requirements.filter((r) => {
      const closed = ["won", "lost", "cancelled"].includes(r.status);
      if (filter === "open" && closed) return false;
      if (filter === "closed" && !closed) return false;
      if (!q) return true;
      const customer = store.customers.find((c) => c.id === r.customerId);
      return (
        r.productName.toLowerCase().includes(q) ||
        (customer?.name || "").toLowerCase().includes(q) ||
        (r.specification || "").toLowerCase().includes(q)
      );
    });
  }, [store.requirements, store.customers, filter, query]);

  if (selected) {
    return (
      <RequirementDetail
        requirement={selected}
        onBack={() => setSelectedId(null)}
        onOpenRecord={onOpenRecord}
        onNotice={setNotice}
        notice={notice}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Requirements"
        subtitle="What customers are asking for, and who can supply it."
        actions={
          <Button variant="filled" icon={Plus} onClick={() => setCreating(true)}>
            Log requirement
          </Button>
        }
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile label="Open" value={String(stats.open)} hint="Live requirements" />
        <StatTile
          label="No supplier yet"
          value={String(stats.unmatched)}
          tone={stats.unmatched ? "caution" : "success"}
          hint="Need sourcing"
        />
        <StatTile label="Quoted" value={String(stats.quoted)} tone="accent" />
        <StatTile
          label="Approved offers"
          value={String(store.pricingRecords.filter((p) => p.status === "approved").length)}
          hint="Available to match against"
        />
      </StatRow>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Segmented<"open" | "all" | "closed">
          className="sm:w-[300px]"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "open", label: "Open" },
            { id: "closed", label: "Closed" },
            { id: "all", label: "All" },
          ]}
        />
        <div className="flex-1">
          <SearchField value={query} onChange={setQuery} placeholder="Product, customer or spec" />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing here"
          description="Log what a customer has asked for and the platform will match it against approved supplier pricing."
          action={
            <Button variant="tinted" icon={Plus} onClick={() => setCreating(true)}>
              Log requirement
            </Button>
          }
        />
      ) : (
        <Group>
          {visible.map((r) => {
            const customer = store.customers.find((c) => c.id === r.customerId);
            const matches = (r.matchedSupplierIds || []).length;
            return (
              <Row
                key={r.id}
                icon={ClipboardList}
                title={r.productName}
                subtitle={`${customer?.name || "—"}${r.quantity ? ` · qty ${r.quantity}` : ""}${
                  r.timing ? ` · ${r.timing}` : ""
                }`}
                trailing={
                  <span className="flex items-center gap-1.5">
                    {matches ? (
                      <Pill tone="success">{matches} supplier{matches === 1 ? "" : "s"}</Pill>
                    ) : (
                      <Pill tone="caution">no match</Pill>
                    )}
                    <StatusPill status={r.status} />
                  </span>
                }
                onClick={() => setSelectedId(r.id)}
              />
            );
          })}
        </Group>
      )}

      {creating ? (
        <RequirementSheet
          onClose={() => setCreating(false)}
          onCreated={(id, message) => {
            setCreating(false);
            setSelectedId(id);
            setNotice(message);
          }}
        />
      ) : null}
    </div>
  );
}

function RequirementDetail({
  requirement,
  onBack,
  onOpenRecord,
  onNotice,
  notice,
}: {
  requirement: CustomerRequirement;
  onBack: () => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
  onNotice: (t: string | null) => void;
  notice: string | null;
}) {
  const store = useStore();
  const customer = store.customers.find((c) => c.id === requirement.customerId);
  const product = store.products.find(
    (p) =>
      p.id === requirement.productId ||
      p.name.toLowerCase() === requirement.productName.toLowerCase(),
  );

  /**
   * Every price we hold for this product, cheapest first — requirement 5.
   * Pending extractions are shown alongside approved ones but visibly marked,
   * because knowing an unreviewed offer exists is useful; quoting from it is
   * not.
   */
  const offers = useMemo(() => {
    const needle = requirement.productName.toLowerCase();
    return store.pricingRecords
      .filter((o) =>
        requirement.productId
          ? o.productId === requirement.productId
          : o.productName.toLowerCase().includes(needle) ||
            needle.includes(o.productName.toLowerCase()),
      )
      .sort((a, b) => a.unitPrice - b.unitPrice);
  }, [store.pricingRecords, requirement]);

  const approvedOffers = offers.filter((o) => o.status === "approved");
  const best = approvedOffers[0];
  const spread =
    approvedOffers.length > 1
      ? approvedOffers[approvedOffers.length - 1].unitPrice - approvedOffers[0].unitPrice
      : 0;

  const quotations = store.quotations.filter(
    (q) => q.customerId === requirement.customerId,
  );

  const related = [
    customer && {
      key: "customer",
      icon: Building2,
      label: "Customer",
      title: customer.name,
      detail: `${customer.status} · ${customer.country}`,
      onOpen: () => onOpenRecord("customers", customer.id),
    },
    product && {
      key: "product",
      icon: Package,
      label: "Product",
      title: product.name,
      detail: product.sku,
      onOpen: () => onOpenRecord("products", product.id),
    },
    ...(requirement.matchedSupplierIds || []).map((sid) => {
      const supplier = store.suppliers.find((s) => s.id === sid);
      return supplier
        ? {
            key: `sup-${sid}`,
            icon: Truck,
            label: "Supplier",
            title: supplier.name,
            detail: `${supplier.status} · delivery ${supplier.deliveryPerformance ?? "—"}%`,
            onOpen: () => onOpenRecord("suppliers", supplier.id),
          }
        : null;
    }),
    quotations.length > 0 && {
      key: "quotes",
      icon: FileText,
      label: "Quotations",
      title: `${quotations.length} for this customer`,
      detail: quotations[0]?.number,
      onOpen: () => onOpenRecord("quotations", quotations[0]?.id),
    },
  ].filter(Boolean) as Parameters<typeof RelatedPanel>[0]["items"];

  return (
    <div className="space-y-5">
      <BackLink label="Requirements" onClick={onBack} />

      <PageHeader
        title={requirement.productName}
        subtitle={`${customer?.name || "—"}${
          requirement.quantity ? ` · qty ${requirement.quantity}` : ""
        }${requirement.timing ? ` · ${requirement.timing}` : ""}`}
        actions={
          <>
            <Button
              variant="tinted"
              icon={Truck}
              onClick={() => {
                const result = store.matchRequirement(requirement.id);
                onNotice(result.message);
              }}
            >
              Match suppliers
            </Button>
            <Button
              variant="filled"
              icon={FileText}
              disabled={!best}
              onClick={() => onOpenRecord("quotations")}
            >
              Draft quotation
            </Button>
          </>
        }
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile
          label="Best approved price"
          value={best ? money(best.unitPrice, best.currency) : "—"}
          tone={best ? "success" : "neutral"}
          hint={best ? best.supplierName : "Nothing approved yet"}
        />
        <StatTile label="Offers on file" value={String(offers.length)} hint={`${approvedOffers.length} approved`} />
        <StatTile
          label="Price spread"
          value={spread ? money(spread, best?.currency) : "—"}
          hint="Cheapest vs dearest"
        />
        <StatTile
          label="Indicative value"
          value={
            best && requirement.quantity
              ? wholeMoney(best.unitPrice * requirement.quantity, best.currency)
              : "—"
          }
          tone="accent"
          hint="At cost, before margin"
        />
      </StatRow>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Group label="Prices received" labelTrailing={`${offers.length}`}>
            {offers.length === 0 ? (
              <p className="px-3.5 py-4 text-[13.5px] text-ink-secondary">
                No supplier has quoted this product yet. Extractions from email and
                WhatsApp land in Pricing for review, and approved offers appear here
                automatically.
              </p>
            ) : (
              offers.map((o, i) => (
                <Row
                  key={o.id}
                  icon={Truck}
                  iconClass={o.status === "approved" ? "bg-success" : "bg-elevated"}
                  title={o.supplierName}
                  subtitle={`${shortDate(o.extractedAt)} · via ${o.source}${
                    o.deliveryInfo ? ` · ${o.deliveryInfo}` : ""
                  }`}
                  value={money(o.unitPrice, o.currency)}
                  valueSub={o.quantity ? `qty ${o.quantity}` : undefined}
                  trailing={
                    <span className="flex items-center gap-1.5">
                      {i === 0 && o.status === "approved" ? (
                        <Pill tone="success">best</Pill>
                      ) : null}
                      <StatusPill status={o.status} />
                    </span>
                  }
                  onClick={() => onOpenRecord("pricing", o.id)}
                />
              ))
            )}
          </Group>

          <Group label="Requirement">
            <FieldRow label="Quantity" value={requirement.quantity ?? "—"} />
            <FieldRow label="Specification" value={requirement.specification || "—"} />
            <FieldRow label="Destination" value={requirement.destination || "—"} />
            <FieldRow label="Delivery" value={requirement.deliveryRequirements || "—"} />
            <FieldRow label="Timing" value={requirement.timing || "—"} />
            <FieldRow label="Commercial" value={requirement.commercialRequirements || "—"} />
            <FieldRow label="Logged" value={shortDate(requirement.createdAt)} />
          </Group>

          <Group label="Status">
            <div className="ios-row flex flex-wrap gap-2 px-3.5 py-3">
              {(["open", "matching", "quoted", "won", "lost", "cancelled"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={requirement.status === s ? "filled" : "tinted"}
                  tone={s === "lost" || s === "cancelled" ? "danger" : s === "won" ? "success" : "accent"}
                  onClick={() => {
                    store.updateRequirement(requirement.id, { status: s });
                    onNotice(`Requirement marked ${s}.`);
                  }}
                >
                  {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
          </Group>
        </div>

        <RelatedPanel items={related} />
      </div>
    </div>
  );
}

function RequirementSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, message: string) => void;
}) {
  const store = useStore();
  const [form, setForm] = useState({
    customerId: store.customers[0]?.id ?? "",
    productName: "",
    quantity: "",
    specification: "",
    destination: "",
    timing: "",
    commercialRequirements: "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Sheet
      title="Log requirement"
      onClose={onClose}
      footer={
        <Button
          variant="filled"
          className="w-full"
          disabled={!form.productName.trim() || !form.customerId}
          onClick={() => {
            const id = store.addRequirement({
              customerId: form.customerId,
              productName: form.productName,
              quantity: form.quantity ? Number(form.quantity) : undefined,
              specification: form.specification || undefined,
              destination: form.destination || undefined,
              timing: form.timing || undefined,
              commercialRequirements: form.commercialRequirements || undefined,
            });
            // Match immediately — the first question anyone asks after logging a
            // requirement is "can we actually supply it?"
            const result = store.matchRequirement(id);
            onCreated(id, result.message);
          }}
        >
          Log and match
        </Button>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] text-ink-secondary">Customer</span>
          <select
            value={form.customerId}
            onChange={(e) => set("customerId", e.target.value)}
            className={inputClass}
          >
            {store.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {([
          ["productName", "Product", "FR4 PCB Board 1.6mm"],
          ["quantity", "Quantity", "10000"],
          ["specification", "Specification", "HASL finish, green solder mask"],
          ["destination", "Destination", "London"],
          ["timing", "Timing", "Within 5 weeks"],
          ["commercialRequirements", "Commercial terms", "30 days, DAP"],
        ] as const).map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-[12.5px] text-ink-secondary">{label}</span>
            <input
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={placeholder}
              className={inputClass}
            />
          </label>
        ))}
      </div>
    </Sheet>
  );
}

/* ========================================================================== */
/* KYC                                                                        */
/* ========================================================================== */

/** The pack Renso actually asks a new account for. Held here rather than in the
 *  domain because it's a policy list, not a record — it changes when compliance
 *  changes its mind, and nothing should break when it does. */
const KYC_CHECKLIST = [
  { key: "incorporation", label: "Certificate of incorporation", match: /incorporat|company|registration/i },
  { key: "vat", label: "VAT registration", match: /vat/i },
  { key: "id", label: "Director ID", match: /\bid\b|passport|director/i },
  { key: "bank", label: "Bank details", match: /bank|iban/i },
  { key: "kyc", label: "Completed KYC pack", match: /kyc|onboard/i },
];

export function KycPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"review" | "all" | "approved">("review");
  const [notice, setNotice] = useState<string | null>(null);

  const selected = store.kycRecords.find((k) => k.id === selectedId) ?? null;

  const stats = useMemo(() => {
    const byStatus = (s: string) => store.kycRecords.filter((k) => k.status === s).length;
    return {
      awaiting: byStatus("submitted") + byStatus("pending"),
      approved: byStatus("approved"),
      rejected: byStatus("rejected"),
      blocked: store.customers.filter(
        (c) => c.kycStatus !== "approved" && c.status !== "inactive",
      ).length,
    };
  }, [store.kycRecords, store.customers]);

  const visible = store.kycRecords.filter((k) => {
    if (filter === "review") return k.status !== "approved" && k.status !== "rejected";
    if (filter === "approved") return k.status === "approved";
    return true;
  });

  if (selected) {
    const customer = store.customers.find((c) => c.id === selected.customerId);
    const docs = store.documents.filter((d) => d.customerId === selected.customerId);
    const checklist = KYC_CHECKLIST.map((item) => ({
      ...item,
      document: docs.find((d) => item.match.test(d.name)),
    }));
    const complete = checklist.filter((c) => c.document).length;

    const related = [
      customer && {
        key: "customer",
        icon: Building2,
        label: "Customer",
        title: customer.name,
        detail: `${customer.status} · KYC ${customer.kycStatus}`,
        onOpen: () => onOpenRecord("customers", customer.id),
      },
      docs.length > 0 && {
        key: "docs",
        icon: FileText,
        label: "Documents",
        title: `${docs.length} on file`,
        detail: "Filed against this account",
        onOpen: () => onOpenRecord("documents"),
      },
    ].filter(Boolean) as Parameters<typeof RelatedPanel>[0]["items"];

    return (
      <div className="space-y-5">
        <BackLink label="KYC" onClick={() => setSelectedId(null)} />
        <PageHeader
          title={customer?.name || "KYC case"}
          subtitle={`Submitted ${shortDate(selected.submittedAt || selected.createdAt)}`}
          actions={
            <>
              <Button
                variant="plain"
                tone="danger"
                onClick={() => {
                  store.updateKycStatus(selected.id, "rejected");
                  setNotice("Case rejected. The customer stays blocked from trading.");
                }}
              >
                Reject
              </Button>
              <Button
                variant="filled"
                tone="success"
                icon={CheckCircle2}
                disabled={complete < checklist.length}
                onClick={() => {
                  store.updateKycStatus(selected.id, "approved");
                  setNotice("Approved. The customer record is updated in the same step.");
                }}
              >
                {complete < checklist.length ? `${complete}/${checklist.length} collected` : "Approve"}
              </Button>
            </>
          }
        />

        {notice ? (
          <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
        ) : null}

        <StatRow>
          <StatTile
            label="Pack complete"
            value={`${complete}/${checklist.length}`}
            tone={complete === checklist.length ? "success" : "caution"}
          />
          <StatTile label="Status" value={selected.status} tone={selected.status === "approved" ? "success" : "accent"} />
          <StatTile label="Documents" value={String(docs.length)} hint="On the account" />
          <StatTile
            label="Trading"
            value={customer?.kycStatus === "approved" ? "Allowed" : "Blocked"}
            tone={customer?.kycStatus === "approved" ? "success" : "danger"}
          />
        </StatRow>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <Group label="Document checklist" labelTrailing={`${complete} of ${checklist.length}`}>
              <div className="ios-row px-3.5 py-3">
                <ProgressBar
                  value={complete / checklist.length}
                  tone={complete === checklist.length ? "success" : "accent"}
                />
              </div>
              {checklist.map((item) => (
                <Row
                  key={item.key}
                  icon={item.document ? CheckCircle2 : FileText}
                  iconClass={item.document ? "bg-success" : "bg-elevated"}
                  title={item.label}
                  subtitle={item.document ? item.document.name : "Not received"}
                  trailing={
                    item.document ? (
                      <Pill tone="success">received</Pill>
                    ) : (
                      <Pill tone="caution">missing</Pill>
                    )
                  }
                  onClick={item.document ? () => onOpenRecord("documents", item.document!.id) : undefined}
                />
              ))}
            </Group>

            {/* Approval is deliberately gated on the checklist. Letting an
                account through with a missing document is precisely the thing
                an onboarding workflow exists to prevent. */}
            <Group label="Review note">
              <div className="ios-row px-3.5 py-3">
                <textarea
                  rows={3}
                  defaultValue={selected.reviewNotes || ""}
                  onBlur={(e) => store.updateKycNotes(selected.id, e.target.value)}
                  placeholder="What was checked, and anything outstanding."
                  className="thin-scroll w-full resize-none rounded-[10px] border border-divider bg-canvas p-3 text-[14px] text-ink outline-none focus:border-accent"
                />
                <p className="mt-2 text-[12px] text-ink-tertiary">
                  Approval is blocked until every document in the checklist is on
                  file — that gate is the point of the workflow.
                </p>
              </div>
            </Group>
          </div>

          <RelatedPanel items={related} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="KYC / Onboarding"
        subtitle="Review, approve, reject — documents land on the customer record."
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile label="Awaiting review" value={String(stats.awaiting)} tone={stats.awaiting ? "accent" : "neutral"} />
        <StatTile label="Approved" value={String(stats.approved)} tone="success" />
        <StatTile label="Rejected" value={String(stats.rejected)} />
        <StatTile
          label="Cannot trade"
          value={String(stats.blocked)}
          tone={stats.blocked ? "caution" : "success"}
          hint="Accounts without approved KYC"
        />
      </StatRow>

      <Segmented<"review" | "all" | "approved">
        className="sm:w-[340px]"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "review", label: "To review" },
          { id: "approved", label: "Approved" },
          { id: "all", label: "All" },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing to review"
          description="Onboarding submissions arrive here, with their documents filed against the customer automatically."
        />
      ) : (
        <Group>
          {visible.map((k) => {
            const customer = store.customers.find((c) => c.id === k.customerId);
            const docs = store.documents.filter((d) => d.customerId === k.customerId);
            const complete = KYC_CHECKLIST.filter((item) =>
              docs.some((d) => item.match.test(d.name)),
            ).length;
            return (
              <Row
                key={k.id}
                icon={ShieldCheck}
                title={customer?.name || k.customerId}
                subtitle={`${complete}/${KYC_CHECKLIST.length} documents · submitted ${shortDate(
                  k.submittedAt || k.createdAt,
                )}`}
                trailing={<StatusPill status={k.status} />}
                onClick={() => setSelectedId(k.id)}
              />
            );
          })}
        </Group>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Portfolio                                                                  */
/* ========================================================================== */

function buildPortfolioHtml(
  rows: { product: Product; offers: PricingRecord[] }[],
  orgLine: string,
) {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = rows
    .map(({ product, offers }) => {
      const best = offers[0];
      return `<tr>
        <td><strong>${esc(product.name)}</strong><br/><span class="sku">${esc(product.sku)}</span></td>
        <td>${esc(product.specifications || product.category || "—")}</td>
        <td>${esc(product.unit)}${product.packaging ? ` · ${esc(product.packaging)}` : ""}</td>
        <td class="num">${
          product.sellingPrice ? `${product.sellingPrice} ${esc(product.currency)}` : "On request"
        }</td>
        <td class="num">${best ? `${best.unitPrice} ${esc(best.currency)}` : "—"}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Renso Group — Product Portfolio</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#101014;max-width:840px;margin:40px auto;padding:0 24px;line-height:1.45}
  h1{font-size:23px;font-weight:650;letter-spacing:-0.02em;margin:0}
  .sub{color:#666;font-size:12.5px;margin:6px 0 28px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#888;border-bottom:1px solid #ddd;padding:0 8px 8px}
  td{border-bottom:1px solid #eee;padding:11px 8px;vertical-align:top}
  .num{text-align:right;white-space:nowrap}
  .sku{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#888}
  .foot{margin-top:34px;font-size:11px;color:#999}
</style></head><body>
<h1>Renso Group — Product Portfolio</h1>
<p class="sub">${esc(orgLine)} · Generated ${new Date().toLocaleDateString("en-GB")} · Confidential</p>
<table>
  <thead><tr><th>Product</th><th>Specification</th><th>Unit</th><th class="num">Indicative sell</th><th class="num">Best cost</th></tr></thead>
  <tbody>${body}</tbody>
</table>
<p class="foot">Prices are indicative and subject to confirmation at the time of order. Contact trading@rensogroup.com</p>
</body></html>`;
}

/**
 * Requirement 4: a portfolio that can be sent to a prospect.
 *
 * The previous version exported everything, always, as a wall of pre-formatted
 * text. Two changes: you choose what goes on the sheet before sending it (you
 * rarely want your whole book in front of one customer), and the export is a
 * real table rather than a text dump.
 */
export function PortfolioPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      store.products.map((product) => {
        const offers = store.pricingRecords
          .filter((o) => o.status === "approved" && o.productId === product.id)
          .sort((a, b) => a.unitPrice - b.unitPrice);
        const best = offers[0];
        const margin =
          best && product.sellingPrice
            ? (product.sellingPrice - best.unitPrice) / product.sellingPrice
            : null;
        return { product, offers, best, margin };
      }),
    [store.products, store.pricingRecords],
  );

  const chosen = rows.filter((r) => selected[r.product.id] ?? true);
  const withOffers = rows.filter((r) => r.best).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Product portfolio"
        subtitle="Choose what a prospect sees, then export a sheet you can send."
        actions={
          <Button
            variant="filled"
            icon={Receipt}
            disabled={chosen.length === 0}
            onClick={() => {
              const org = store.organisation;
              const html = buildPortfolioHtml(
                chosen.map((r) => ({ product: r.product, offers: r.offers })),
                [org.addressLine1, org.city, org.postcode].filter(Boolean).join(", "),
              );
              const blob = new Blob([html], { type: "text/html" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `renso-portfolio-${new Date().toISOString().slice(0, 10)}.html`;
              a.click();
              URL.revokeObjectURL(url);
              setNotice(`${chosen.length} product${chosen.length === 1 ? "" : "s"} exported — open it and print to PDF.`);
            }}
          >
            Export {chosen.length} product{chosen.length === 1 ? "" : "s"}
          </Button>
        }
      />

      {notice ? (
        <div className="ios-group px-3.5 py-2.5 text-[13.5px] text-accent">{notice}</div>
      ) : null}

      <StatRow>
        <StatTile label="Products" value={String(rows.length)} />
        <StatTile
          label="With approved cost"
          value={String(withOffers)}
          tone={withOffers === rows.length ? "success" : "caution"}
          hint="Priced from a real offer"
        />
        <StatTile label="On the sheet" value={String(chosen.length)} tone="accent" />
        <StatTile
          label="Suppliers quoted"
          value={String(
            new Set(
              store.pricingRecords
                .filter((o) => o.status === "approved")
                .map((o) => o.supplierId),
            ).size,
          )}
        />
      </StatRow>

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Add products and approve supplier offers against them to build a sendable portfolio."
        />
      ) : (
        <Group label="Products" labelTrailing="Tap a row to include or exclude it">
          {rows.map(({ product, offers, best, margin }) => {
            const included = selected[product.id] ?? true;
            return (
              <div key={product.id} className="ios-row px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((s) => ({ ...s, [product.id]: !included }))
                    }
                    aria-label={included ? "Remove from sheet" : "Add to sheet"}
                    className="brand-focus mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors"
                    style={{
                      borderColor: included ? "rgb(var(--accent))" : "rgb(var(--divider))",
                      backgroundColor: included ? "rgb(var(--accent))" : "transparent",
                    }}
                  >
                    {included ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenRecord("products", product.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-[15px] font-medium text-ink">{product.name}</div>
                    <div className="truncate font-mono text-[12px] text-ink-tertiary">
                      {product.sku} · {product.unit}
                      {product.category ? ` · ${product.category}` : ""}
                    </div>
                  </button>
                  <div className="shrink-0 text-right">
                    <div className="tnum text-[15px] font-semibold text-ink">
                      {product.sellingPrice
                        ? money(product.sellingPrice, product.currency)
                        : "On request"}
                    </div>
                    <div className="tnum text-[12px] text-ink-tertiary">
                      {best ? `cost ${money(best.unitPrice, best.currency)}` : "no approved cost"}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[34px]">
                  {margin !== null ? (
                    <Pill tone={margin > 0.2 ? "success" : margin > 0 ? "caution" : "danger"}>
                      {Math.round(margin * 100)}% margin
                    </Pill>
                  ) : (
                    <Pill tone="neutral">margin unavailable</Pill>
                  )}
                  {offers.length > 1 ? (
                    <Pill tone="accent">{offers.length} suppliers quoted</Pill>
                  ) : null}
                  {offers.map((o) => (
                    <span key={o.id} className="ios-pill ios-pill-neutral">
                      {o.supplierName}: {money(o.unitPrice, o.currency)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </Group>
      )}

      <p className="px-1 text-[12px] leading-relaxed text-ink-tertiary">
        Margin is measured against the cheapest <em>approved</em> supplier offer.
        A product with no approved offer reports margin as unavailable rather than
        assuming one, because a made-up margin on a price list is worse than a
        visible gap.
      </p>
    </div>
  );
}
