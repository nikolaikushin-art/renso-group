import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  Contact,
  Customer,
  Supplier,
  Product,
  PricingRecord,
  Quotation,
  Order,
  Invoice,
  CustomerRequirement,
  Opportunity,
  Communication,
  Document,
  KycRecord,
  User,
  DashboardMetrics,
  AiExtractionJob,
  Organisation,
  CrmSettings,
  SalesSettings,
  ProductSettings,
  QuotationLine,
  MailFolder,
  Campaign,
  CampaignAudience,
  CampaignRecipient,
  Expense,
  Payment,
  Delivery,
  TradeSettings,
} from "./domain";
import { seedData } from "./seed";
import { documentsNeedingAttention } from "./documents";
import { isCostOfSales } from "./accounting";
import {
  computeTotals,
  nextDocumentNumber,
  toQuotationLines,
  type DraftLine,
} from "./lines";
import { checkDespatch, fulfilmentRatio } from "./fulfilment";
import type { FxRate, FxTable } from "./fx";

/** Maps a filename onto a document category so filed attachments land in the
 *  right bucket instead of everything becoming "other". */
function inferDocumentType(name: string): Document["type"] {
  const n = name.toLowerCase();
  if (/(^|[^a-z])inv|invoice/.test(n)) return "invoice";
  if (/(^|[^a-z])qt|quotation|quote/.test(n)) return "quotation";
  if (/(^|[^a-z])so|order/.test(n)) return "order";
  if (/kyc|onboarding|incorporation/.test(n)) return "kyc";
  if (/cert|iso|insurance/.test(n)) return "certificate";
  if (/contract|agreement/.test(n)) return "contract";
  return "correspondence";
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
};

export interface ParsedTerms {
  quantity?: number;
  unitPrice?: number;
  currency?: string;
  deliveryInfo?: string;
  commercialTerms?: string;
  productName?: string;
}

/**
 * Pulls commercial terms out of free-text supplier correspondence.
 *
 * This is the deterministic pass that stands in for the LLM call in the hosted
 * product. It is deliberately conservative: if it cannot find a unit price it
 * returns nothing rather than guessing, because a wrong price banked silently
 * is far more damaging than an offer that needs typing in by hand.
 */
export function parseCommercialTerms(text: string): ParsedTerms {
  const out: ParsedTerms = {};
  const flat = text.replace(/\s+/g, " ");

  // Unit price: "at $1.98 each", "EUR 11.40/m", "GBP 3.25 per unit".
  const priceMatch =
    flat.match(/(?:at|@)\s*([$£€])\s*([\d,]+(?:\.\d+)?)/i) ||
    flat.match(/\b(USD|GBP|EUR|CNY)\s*([\d,]+(?:\.\d+)?)/i) ||
    flat.match(/([$£€])\s*([\d,]+(?:\.\d+)?)\s*(?:each|per|\/)/i);
  if (priceMatch) {
    const token = priceMatch[1];
    out.currency = CURRENCY_SYMBOLS[token] || token.toUpperCase();
    out.unitPrice = Number(priceMatch[2].replace(/,/g, ""));
  }

  // Quantity: "5,000 units", "500 pcs", "240 boxes".
  const qtyMatch = flat.match(/([\d,]+)\s*(?:units?|pcs|pieces|boxes|bags|tonnes?|m\b)/i);
  if (qtyMatch) out.quantity = Number(qtyMatch[1].replace(/,/g, ""));

  // Delivery: "delivery in 3 weeks", "lead time 12–15 working days".
  const deliveryMatch = flat.match(
    /(?:delivery|lead time)[^.]{0,60}?(\d+(?:\s*[–-]\s*\d+)?\s*(?:working\s*)?(?:days?|weeks?|months?))/i,
  );
  if (deliveryMatch) out.deliveryInfo = deliveryMatch[1].trim();

  // Incoterm and payment terms sit together as free-text commercial terms.
  const parts: string[] = [];
  const incoterm = flat.match(/\b(FOB|CIF|EXW|DDP|DAP|FCA|CFR)\s+[A-Z][A-Za-z]+/);
  if (incoterm) parts.push(incoterm[0]);
  const payment = flat.match(/(?:terms|payment)[^.]{0,80}/i);
  if (payment) parts.push(payment[0].trim());
  if (parts.length) out.commercialTerms = parts.join(" · ");

  return out;
}

/**
 * Fills the merge fields a campaign template can use. Unknown tokens are left
 * alone rather than blanked, so a typo shows up in the preview instead of
 * silently mailing a sentence with a hole in it.
 */
export function renderTemplate(body: string, recipientName: string, senderName: string) {
  const first = recipientName.split(/\s+/)[0] || recipientName;
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*name\s*\}\}/g, recipientName)
    .replace(/\{\{\s*company\s*\}\}/g, recipientName)
    .replace(/\{\{\s*sender_name\s*\}\}/g, senderName);
}

interface StoreState {
  user: User | null;
  customers: Customer[];
  contacts: Contact[];
  suppliers: Supplier[];
  products: Product[];
  pricingRecords: PricingRecord[];
  quotations: Quotation[];
  orders: Order[];
  invoices: Invoice[];
  requirements: CustomerRequirement[];
  opportunities: Opportunity[];
  communications: Communication[];
  documents: Document[];
  kycRecords: KycRecord[];
  extractionJobs: AiExtractionJob[];
  campaigns: Campaign[];
  expenses: Expense[];
  payments: Payment[];
  deliveries: Delivery[];
  isAuthenticated: boolean;
  organisation: Organisation;
  users: User[];
  crmSettings: CrmSettings;
  salesSettings: SalesSettings;
  productSettings: ProductSettings;
  /** Manually maintained rate table. See `lib/fx.ts` for why it is manual. */
  fx: FxTable;
  tradeSettings: TradeSettings;
  /** Signals the user has cleared this session, by signal id. */
  dismissedSignals: string[];
}

/**
 * Shared payload for the quotation and order forms. `lines` is the source of
 * truth; `total` is only honoured as a fallback for callers that still create a
 * single-value document without a line breakdown.
 */
export interface DocumentInput {
  customerId: string;
  title: string;
  currency?: string;
  lines?: DraftLine[];
  taxRatePct?: number;
  total?: number;
  notes?: string;
  opportunityId?: string;
  validUntil?: string;
}

/** Payload for the mail composer — reply, forward and new message all share it. */
export interface ComposeInput {
  channel?: "email" | "whatsapp";
  to: string;
  cc?: string;
  subject: string;
  body: string;
  customerId?: string;
  supplierId?: string;
  contactId?: string;
  quotationId?: string;
  orderId?: string;
  invoiceId?: string;
  threadId?: string;
  /** Save to Drafts instead of Sent. */
  asDraft?: boolean;
}

export interface OpportunityInput {
  customerId: string;
  title: string;
  stage?: Opportunity["stage"];
  value?: number;
  currency?: string;
  requirementId?: string;
  productId?: string;
  supplierId?: string;
  ownerId?: string;
  nextAction?: string;
  nextActionDue?: string;
  notes?: string;
}

interface StoreActions {
  signIn: (email: string, password: string) => boolean;
  /** Opens the app without credentials, as a read-labelled demo session.
   *  Sign-in is a gate on a prototype, not a security boundary — pretending
   *  otherwise just costs a reviewer thirty seconds. */
  continueAsGuest: () => void;
  signOut: () => void;
  getMetrics: () => DashboardMetrics;
  approvePricing: (id: string) => void;
  rejectPricing: (id: string) => void;
  updatePricing: (id: string, patch: Partial<PricingRecord>) => void;
  addCustomer: (c: Partial<Customer>) => void;
  updateCustomer: (id: string, patch: Partial<Customer>) => void;
  removeCustomer: (id: string) => void;
  addSupplier: (s: Partial<Supplier>) => void;
  updateSupplier: (id: string, patch: Partial<Supplier>) => void;
  removeSupplier: (id: string) => void;
  addContact: (c: Partial<Contact>) => void;
  addProduct: (p: Partial<Product>) => void;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  removeProduct: (id: string) => void;
  addDocument: (d: Partial<Document>) => void;
  updateDocument: (id: string, patch: Partial<Document>) => void;
  removeDocument: (id: string) => void;
  updateKycStatus: (id: string, status: KycRecord["status"]) => void;
  /** Reviewer's working note on a KYC case, saved independently of the
   *  approve/reject decision so a part-finished review isn't lost. */
  updateKycNotes: (id: string, notes: string) => void;
  convertQuotationToOrder: (quotationId: string) => string | null;
  convertOrderToInvoice: (orderId: string) => string | null;
  runHistoricalEmailScan: () => { created: number; message: string };
  /* --- Mailbox ---------------------------------------------------------- */
  markCommunicationRead: (id: string, isRead?: boolean) => void;
  toggleCommunicationStar: (id: string) => void;
  toggleCommunicationFlag: (id: string) => void;
  moveCommunication: (id: string, folder: MailFolder) => void;
  /** Sends (or files as draft) a composed message and returns its id. */
  sendCommunication: (input: ComposeInput) => string;
  /** Files an email attachment into Documents against the linked
   *  customer/supplier, and stamps the attachment so it can't be filed twice. */
  fileAttachment: (communicationId: string, attachmentId: string) => string | null;
  /** Banks the commercial terms found in a received message as a pricing
   *  record in the review queue. Returns the new record id. */
  extractFromCommunication: (id: string) => string | null;
  /* --- Campaigns / mass mailing ---------------------------------------- */
  /** Resolves an audience definition to the live recipient list. Pure, so the
   *  builder can show the real count before anything is saved or sent. */
  resolveAudience: (audience: CampaignAudience) => CampaignRecipient[];
  addCampaign: (input: Partial<Campaign>) => string;
  updateCampaign: (id: string, patch: Partial<Campaign>) => void;
  removeCampaign: (id: string) => void;
  /** Sends a campaign: resolves the audience, writes one outbound message per
   *  recipient into their account timeline, and records engagement. */
  sendCampaign: (id: string) => { sent: number; message: string };
  /* --- Finance ---------------------------------------------------------- */
  addExpense: (input: Partial<Expense>) => string;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  removeExpense: (id: string) => void;
  /** Records money received against an invoice, updating the invoice's paid
   *  amount and status in the same transaction so the two can't drift. */
  recordReceipt: (input: {
    invoiceId: string;
    amount: number;
    method?: Payment["method"];
    reference?: string;
    paidAt?: string;
    notes?: string;
  }) => string | null;
  /** Records money paid out against an expense. */
  recordSupplierPayment: (input: {
    expenseId: string;
    amount: number;
    method?: Payment["method"];
    reference?: string;
    paidAt?: string;
  }) => string | null;
  /* --- Fulfilment ------------------------------------------------------- */
  /** Records a despatch against an order. Rejects over-despatch with a reason
   *  and advances the order's status to shipped/delivered in the same
   *  transaction, so the order list can never disagree with its own
   *  delivery notes. */
  addDelivery: (input: {
    orderId: string;
    quantities: Record<string, number>;
    carrier?: string;
    trackingRef?: string;
    despatchedAt?: string;
    incoterms?: string;
    destination?: string;
    notes?: string;
  }) => { id: string | null; message: string };
  markDeliveryArrived: (id: string, deliveredAt?: string) => void;
  removeDelivery: (id: string) => void;
  /* --- Requirements ----------------------------------------------------- */
  addRequirement: (input: Partial<CustomerRequirement>) => string;
  updateRequirement: (id: string, patch: Partial<CustomerRequirement>) => void;
  removeRequirement: (id: string) => void;
  /** Re-runs supplier matching for a requirement against approved pricing.
   *  Matching is recomputed rather than stored as a verdict, so a requirement
   *  can't keep claiming a supplier match after that offer has been rejected. */
  matchRequirement: (id: string) => { matched: number; message: string };
  addQuotation: (input: DocumentInput) => string;
  updateQuotation: (id: string, patch: Partial<Quotation>) => void;
  updateQuotationStatus: (id: string, status: Quotation["status"]) => void;
  addOrder: (input: DocumentInput & { deliveryDate?: string }) => string;
  updateOrder: (id: string, patch: Partial<Order>) => void;
  updateOrderStatus: (id: string, status: Order["status"]) => void;
  addOpportunity: (input: OpportunityInput) => string;
  updateOpportunity: (id: string, patch: Partial<Opportunity>) => void;
  removeOpportunity: (id: string) => void;
  updateOpportunityStage: (id: string, stage: Opportunity["stage"]) => void;
  markInvoicePaid: (id: string) => void;
  updateOrganisation: (patch: Partial<Organisation>) => void;
  addUser: (u: Partial<User>) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  removeUser: (id: string) => void;
  /** Replaces the rate table. Each rate carries the date it was entered, so a
   *  save re-stamps only the rates that actually changed. */
  updateFxRates: (rates: FxRate[]) => void;
  setReportingCurrency: (currency: string) => void;
  updateTradeSettings: (patch: Partial<TradeSettings>) => void;
  /** Clears a signal for this session. Signals are derived, never stored, so a
   *  dismissal suppresses the row rather than editing the underlying record —
   *  if the invoice is still overdue tomorrow, the signal comes back. */
  dismissSignal: (id: string) => void;
  restoreSignals: () => void;
  updateCrmSettings: (patch: Partial<CrmSettings>) => void;
  updateSalesSettings: (patch: Partial<SalesSettings>) => void;
  updateProductSettings: (patch: Partial<ProductSettings>) => void;
}

type Store = StoreState & StoreActions;

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>(() => ({
    ...seedData,
    isAuthenticated: false,
    user: null,
  }));

  const signIn = useCallback((email: string, password: string) => {
    if (!email.trim() || password !== "roni") return false;
    const isRoni = email.toLowerCase().includes("roni");
    const user: User = {
      id: "u1",
      email: isRoni ? "roni@rensogroup.com" : email,
      name: isRoni ? "Roni Ornadel" : "Renso User",
      role: "administrator",
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, isAuthenticated: true, user }));
    return true;
  }, []);

  const continueAsGuest = useCallback(() => {
    const user: User = {
      id: "guest",
      email: "guest@rensogroup.com",
      name: "Guest",
      role: "readonly",
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ ...s, isAuthenticated: true, user }));
  }, []);

  const signOut = useCallback(() => {
    setState((s) => ({ ...s, isAuthenticated: false, user: null }));
  }, []);

  const getMetrics = useCallback((): DashboardMetrics => {
    // Revenue from issued + paid invoices (live calculation against CRM data)
    const totalRevenue = state.invoices
      .filter((i) => i.status === "paid" || i.status === "issued")
      .reduce((sum, i) => sum + i.total, 0);

    // Gross and net profit are now *measured* from booked expenses rather
    // than estimated from a supplier-spend proxy: costs categorised as cost of
    // sales reduce gross profit, everything else reduces net. Where no costs
    // have been booked at all we fall back to the old proxy so the dashboard
    // isn't blank, but Accounting is explicit about which figure it is showing.
    const costOfSales = state.expenses
      .filter((e) => isCostOfSales(e.category))
      .reduce((sum, e) => sum + e.net, 0);
    const overheads = state.expenses
      .filter((e) => !isCostOfSales(e.category))
      .reduce((sum, e) => sum + e.net, 0);

    const hasBookedCosts = state.expenses.length > 0;
    const totalSupplierSpend = state.suppliers.reduce(
      (sum, s) => sum + (s.totalSpend || 0),
      0,
    );

    const grossProfit = hasBookedCosts
      ? totalRevenue - costOfSales
      : totalRevenue > 0
        ? Math.max(0, totalRevenue - totalSupplierSpend * 0.35)
        : 0;
    const netProfit = hasBookedCosts
      ? grossProfit - overheads
      : Math.max(0, grossProfit * 0.85);

    const attention = documentsNeedingAttention(
      state.documents,
      state.crmSettings.documentExpiryWarningDays,
    );

    return {
      totalRevenue,
      grossProfit,
      netProfit,
      openOpportunities: state.opportunities.filter((o) =>
        !["closed_won", "closed_lost"].includes(o.stage),
      ).length,
      pendingKyc: state.kycRecords.filter((k) =>
        ["sent", "submitted", "under_review"].includes(k.status),
      ).length,
      newOffers: state.pricingRecords.filter((p) => p.status === "pending_review").length,
      activeRequirements: state.requirements.filter((r) =>
        ["open", "matching"].includes(r.status),
      ).length,
      followUpsDue: state.quotations.filter((q) => q.status === "sent").length,
      documentsExpiring: attention.filter((a) => a.expiry.state === "expiring").length,
      documentsExpired: attention.filter((a) => a.expiry.state === "expired").length,
      topCustomers: state.customers
        .map((c) => ({
          id: c.id,
          name: c.name,
          revenue:
            state.invoices
              .filter((i) => i.customerId === c.id && (i.status === "paid" || i.status === "issued"))
              .reduce((sum, i) => sum + (i.total || 0), 0) || c.totalRevenue || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5),
      topSuppliers: state.suppliers
        .slice()
        .sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0))
        .slice(0, 5)
        .map((s) => ({ id: s.id, name: s.name, spend: s.totalSpend || 0 })),
      recentPricingChanges: state.pricingRecords
        .slice()
        .sort((a, b) => b.extractedAt.localeCompare(a.extractedAt))
        .slice(0, 6),
    };
  }, [state]);

  const approvePricing = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      pricingRecords: s.pricingRecords.map((p) =>
        p.id === id
          ? {
              ...p,
              status: "approved",
              approvedAt: new Date().toISOString(),
              approvedBy: s.user?.id,
            }
          : p,
      ),
    }));
  }, []);

  const rejectPricing = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      pricingRecords: s.pricingRecords.map((p) =>
        p.id === id ? { ...p, status: "rejected" } : p,
      ),
    }));
  }, []);

  const updatePricing = useCallback((id: string, patch: Partial<PricingRecord>) => {
    setState((s) => ({
      ...s,
      pricingRecords: s.pricingRecords.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
      ),
    }));
  }, []);

  const addCustomer = useCallback((c: Partial<Customer>) => {
    const id = `c_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      customers: [
        {
          id,
          name: c.name || "New Customer",
          status: "lead",
          segment: "wholesale",
          country: "United Kingdom",
          currency: "GBP",
          tags: [],
          kycStatus: "none",
          createdAt: now,
          updatedAt: now,
          ...c,
        } as Customer,
        ...s.customers,
      ],
    }));
  }, []);

  const addSupplier = useCallback((s: Partial<Supplier>) => {
    const id = `s_${Date.now()}`;
    const now = new Date().toISOString();
    setState((st) => ({
      ...st,
      suppliers: [
        {
          id,
          name: s.name || "New Supplier",
          status: "active",
          country: "China",
          currency: "USD",
          tags: [],
          createdAt: now,
          updatedAt: now,
          ...s,
        } as Supplier,
        ...st.suppliers,
      ],
    }));
  }, []);

  const addContact = useCallback((c: Partial<Contact>) => {
    const id = `ct_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      contacts: [
        {
          id,
          firstName: c.firstName || "New",
          lastName: c.lastName || "Contact",
          email: c.email,
          phone: c.phone,
          jobTitle: c.jobTitle,
          isPrimary: c.isPrimary ?? false,
          customerId: c.customerId,
          supplierId: c.supplierId,
          createdAt: now,
          updatedAt: now,
          ...c,
        } as Contact,
        ...s.contacts,
      ],
    }));
  }, []);


  const convertQuotationToOrder = useCallback((quotationId: string) => {
    let newId: string | null = null;
    setState((s) => {
      const q = s.quotations.find((x) => x.id === quotationId);
      if (!q || q.status === "converted") return s;
      const id = `o_${Date.now()}`;
      newId = id;
      const now = new Date().toISOString();
      const order = {
        id,
        number: nextDocumentNumber(s.salesSettings.orderPrefix || "SO-", s.orders),
        customerId: q.customerId,
        quotationId: q.id,
        status: "confirmed" as const,
        lines: q.lines,
        currency: q.currency,
        subtotal: q.subtotal,
        tax: q.tax,
        total: q.total,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...s,
        orders: [order, ...s.orders],
        quotations: s.quotations.map((x) =>
          x.id === quotationId
            ? { ...x, status: "converted" as const, convertedOrderId: id, updatedAt: now }
            : x,
        ),
        // Keep the linked opportunity's stage honest with what actually exists.
        opportunities: q.opportunityId
          ? s.opportunities.map((o) =>
              o.id === q.opportunityId &&
              ["enquiry", "quotation"].includes(o.stage)
                ? { ...o, stage: "order" as const, updatedAt: now }
                : o,
            )
          : s.opportunities,
      };
    });
    return newId;
  }, []);

  const convertOrderToInvoice = useCallback((orderId: string) => {
    let newId: string | null = null;
    setState((s) => {
      const o = s.orders.find((x) => x.id === orderId);
      if (!o || s.invoices.some((invoice) => invoice.orderId === orderId)) return s;
      const id = `i_${Date.now()}`;
      newId = id;
      const now = new Date().toISOString();
      const invoice = {
        id,
        number: nextDocumentNumber("INV-2026-", s.invoices),
        customerId: o.customerId,
        orderId: o.id,
        status: "issued" as const,
        lines: o.lines,
        currency: o.currency,
        subtotal: o.subtotal,
        tax: o.tax,
        total: o.total,
        issuedAt: now,
        dueAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };
      const linkedQuotation = s.quotations.find((x) => x.convertedOrderId === o.id);
      return {
        ...s,
        invoices: [invoice, ...s.invoices],
        orders: s.orders.map((x) =>
          x.id === orderId && ["draft", "confirmed"].includes(x.status)
            ? { ...x, status: "in_progress" as const, updatedAt: now }
            : x,
        ),
        opportunities: linkedQuotation?.opportunityId
          ? s.opportunities.map((opp) =>
              opp.id === linkedQuotation.opportunityId &&
              !["closed_won", "closed_lost", "payment"].includes(opp.stage)
                ? { ...opp, stage: "invoice" as const, updatedAt: now }
                : opp,
            )
          : s.opportunities,
      };
    });
    return newId;
  }, []);

  const updateCustomer = useCallback((id: string, patch: Partial<Customer>) => {
    setState((s) => ({
      ...s,
      customers: s.customers.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
      ),
    }));
  }, []);

  const removeCustomer = useCallback((id: string) => {
    setState((s) => ({ ...s, customers: s.customers.filter((c) => c.id !== id) }));
  }, []);

  const updateSupplier = useCallback((id: string, patch: Partial<Supplier>) => {
    setState((s) => ({
      ...s,
      suppliers: s.suppliers.map((x) =>
        x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x,
      ),
    }));
  }, []);

  const removeSupplier = useCallback((id: string) => {
    setState((s) => ({ ...s, suppliers: s.suppliers.filter((x) => x.id !== id) }));
  }, []);

  const addProduct = useCallback((p: Partial<Product>) => {
    const id = `pr_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      products: [
        {
          id,
          name: p.name || "New product",
          sku: p.sku || `SKU-${Date.now().toString().slice(-6)}`,
          category: p.category || "General",
          unit: p.unit || "unit",
          sellingPrice: p.sellingPrice ?? 0,
          purchasePrice: p.purchasePrice ?? 0,
          currency: p.currency || "GBP",
          specifications: p.specifications || "",
          supplierIds: p.supplierIds || [],
          tags: p.tags || [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        } as Product,
        ...s.products,
      ],
    }));
  }, []);

  const updateProduct = useCallback((id: string, patch: Partial<Product>) => {
    setState((s) => ({
      ...s,
      products: s.products.map((x) =>
        x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x,
      ),
    }));
  }, []);

  const removeProduct = useCallback((id: string) => {
    setState((s) => ({ ...s, products: s.products.filter((x) => x.id !== id) }));
  }, []);

  const addDocument = useCallback((d: Partial<Document>) => {
    const id = `doc_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      documents: [
        {
          // Spread the caller's fields first so everything the form collects —
          // reference, issuedAt, expiresAt, productId — is persisted rather than
          // silently dropped, then force the identity fields we own.
          ...d,
          id,
          name: d.name || "New document",
          type: (d.type as Document["type"]) || "other",
          createdAt: d.createdAt || now,
          uploadedBy: d.uploadedBy || s.user?.id,
        } as Document,
        ...s.documents,
      ],
    }));
  }, []);

  const updateDocument = useCallback((id: string, patch: Partial<Document>) => {
    setState((s) => ({
      ...s,
      documents: s.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }, []);

  const removeDocument = useCallback((id: string) => {
    setState((s) => ({ ...s, documents: s.documents.filter((x) => x.id !== id) }));
  }, []);

  const updateKycNotes = useCallback((id: string, notes: string) => {
    setState((s) => ({
      ...s,
      kycRecords: s.kycRecords.map((k) =>
        k.id === id ? { ...k, reviewNotes: notes, updatedAt: new Date().toISOString() } : k,
      ),
    }));
  }, []);

  const updateKycStatus = useCallback((id: string, status: KycRecord["status"]) => {
    setState((s) => ({
      ...s,
      kycRecords: s.kycRecords.map((k) =>
        k.id === id ? { ...k, status, updatedAt: new Date().toISOString() } : k,
      ),
    }));
  }, []);

  /**
   * Build a quotation from editor lines. Falls back to a single synthetic line
   * when a caller supplies only a headline total, so older call sites and the
   * quick-create path still produce a well-formed document.
   */
  const addQuotation = useCallback((input: DocumentInput) => {
    const id = `q_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const currency = input.currency || "GBP";
      const taxRatePct = input.taxRatePct ?? s.salesSettings.defaultTaxRatePct ?? 0;
      const draftLines: DraftLine[] =
        input.lines && input.lines.length
          ? input.lines
          : [
              {
                id: `ql_${Date.now()}`,
                description: input.title,
                quantity: 1,
                unitPrice: input.total ?? 0,
              },
            ];
      const lines: QuotationLine[] = toQuotationLines(draftLines, currency);
      const totals = computeTotals(lines, taxRatePct);
      const validUntil =
        input.validUntil ||
        new Date(
          Date.now() + (s.salesSettings.quotationValidityDays || 30) * 86400000,
        ).toISOString();
      const q: Quotation = {
        id,
        number: nextDocumentNumber(s.salesSettings.quotationPrefix || "QT-", s.quotations),
        customerId: input.customerId,
        opportunityId: input.opportunityId,
        status: "draft",
        notes: input.notes ?? input.title,
        lines,
        currency,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        validUntil,
        createdAt: now,
        updatedAt: now,
        createdBy: s.user?.id,
      };
      return {
        ...s,
        quotations: [q, ...s.quotations],
        // A quotation existing for an opportunity is itself a stage change.
        opportunities: input.opportunityId
          ? s.opportunities.map((o) =>
              o.id === input.opportunityId && o.stage === "enquiry"
                ? { ...o, stage: "quotation" as const, updatedAt: now }
                : o,
            )
          : s.opportunities,
      };
    });
    return id;
  }, []);

  const updateQuotation = useCallback((id: string, patch: Partial<Quotation>) => {
    setState((s) => ({
      ...s,
      quotations: s.quotations.map((q) =>
        q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q,
      ),
    }));
  }, []);

  /** Standalone order (no originating quotation) — same line maths. */
  const addRequirement = useCallback((input: Partial<CustomerRequirement>) => {
    const id = `req_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const requirement: CustomerRequirement = {
        id,
        customerId: input.customerId || "",
        productName: (input.productName || "").trim() || "Requirement",
        productId: input.productId,
        quantity: input.quantity,
        specification: input.specification,
        destination: input.destination,
        deliveryRequirements: input.deliveryRequirements,
        timing: input.timing,
        commercialRequirements: input.commercialRequirements,
        status: input.status || "open",
        ownerId: input.ownerId || s.user?.id,
        matchedSupplierIds: input.matchedSupplierIds || [],
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };
      return { ...s, requirements: [requirement, ...s.requirements] };
    });
    return id;
  }, []);

  const updateRequirement = useCallback((id: string, patch: Partial<CustomerRequirement>) => {
    setState((s) => ({
      ...s,
      requirements: s.requirements.map((r) =>
        r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r,
      ),
    }));
  }, []);

  const removeRequirement = useCallback((id: string) => {
    setState((s) => ({ ...s, requirements: s.requirements.filter((r) => r.id !== id) }));
  }, []);

  const matchRequirement = useCallback((id: string) => {
    let matched = 0;
    let message = "No approved supplier offer matches this requirement yet.";
    setState((s) => {
      const requirement = s.requirements.find((r) => r.id === id);
      if (!requirement) return s;
      // Match on the linked product where we have one, otherwise on the
      // product name the customer used. Only approved offers count — an
      // unreviewed extraction is not something to promise a customer against.
      const needle = requirement.productName.toLowerCase();
      const offers = s.pricingRecords.filter(
        (o) =>
          o.status === "approved" &&
          (requirement.productId
            ? o.productId === requirement.productId
            : o.productName.toLowerCase().includes(needle)),
      );
      const supplierIds = Array.from(
        new Set(offers.map((o) => o.supplierId).filter(Boolean) as string[]),
      );
      matched = supplierIds.length;
      message = matched
        ? `${matched} supplier${matched === 1 ? "" : "s"} can cover this requirement.`
        : message;
      return {
        ...s,
        requirements: s.requirements.map((r) =>
          r.id === id
            ? {
                ...r,
                matchedSupplierIds: supplierIds,
                status: matched ? ("matching" as const) : r.status,
                updatedAt: new Date().toISOString(),
              }
            : r,
        ),
      };
    });
    return { matched, message };
  }, []);

  const addDelivery = useCallback(
    (input: {
      orderId: string;
      quantities: Record<string, number>;
      carrier?: string;
      trackingRef?: string;
      despatchedAt?: string;
      incoterms?: string;
      destination?: string;
      notes?: string;
    }) => {
      const id = `dl_${Date.now()}`;
      let message = "Despatch recorded.";
      let created: string | null = null;
      setState((s) => {
        const order = s.orders.find((o) => o.id === input.orderId);
        if (!order) {
          message = "That order no longer exists.";
          return s;
        }
        const check = checkDespatch(order, s.deliveries, input.quantities);
        if (!check.ok) {
          message = check.reason || "Despatch refused.";
          return s;
        }
        const now = new Date().toISOString();
        const delivery: Delivery = {
          id,
          orderId: order.id,
          // Delivery notes are numbered per order — DN-SO-2026-0018-02 tells you
          // at a glance which order it belongs to and that it's the second drop.
          reference: `DN-${order.number}-${String(
            s.deliveries.filter((d) => d.orderId === order.id).length + 1,
          ).padStart(2, "0")}`,
          quantities: input.quantities,
          carrier: input.carrier,
          trackingRef: input.trackingRef,
          despatchedAt: input.despatchedAt || now,
          incoterms: input.incoterms || order.incoterms,
          destination: input.destination || order.deliveryAddress,
          notes: input.notes,
          createdAt: now,
        };
        const deliveries = [delivery, ...s.deliveries];
        // Status follows the despatches rather than being set by hand: a fully
        // shipped order is "shipped", a partial one stays in progress.
        const ratio = fulfilmentRatio(order, deliveries);
        const status =
          order.status === "cancelled"
            ? order.status
            : ratio >= 1
              ? ("shipped" as const)
              : ("in_progress" as const);
        created = id;
        message =
          ratio >= 1
            ? "Despatch recorded — order fully shipped."
            : `Despatch recorded — ${Math.round(ratio * 100)}% of the order shipped.`;
        return {
          ...s,
          deliveries,
          orders: s.orders.map((o) =>
            o.id === order.id ? { ...o, status, updatedAt: now } : o,
          ),
        };
      });
      return { id: created, message };
    },
    [],
  );

  const markDeliveryArrived = useCallback((id: string, deliveredAt?: string) => {
    setState((s) => {
      const delivery = s.deliveries.find((d) => d.id === id);
      if (!delivery) return s;
      const when = deliveredAt || new Date().toISOString();
      const deliveries = s.deliveries.map((d) =>
        d.id === id ? { ...d, deliveredAt: when } : d,
      );
      const order = s.orders.find((o) => o.id === delivery.orderId);
      // The order only becomes "delivered" once everything shipped has also
      // arrived — otherwise a part-arrived order would read as complete.
      const allArrived =
        order &&
        fulfilmentRatio(order, deliveries) >= 1 &&
        deliveries.filter((d) => d.orderId === order.id).every((d) => d.deliveredAt);
      return {
        ...s,
        deliveries,
        orders: allArrived
          ? s.orders.map((o) =>
              o.id === order!.id && o.status !== "cancelled"
                ? { ...o, status: "delivered" as const, updatedAt: when }
                : o,
            )
          : s.orders,
      };
    });
  }, []);

  const removeDelivery = useCallback((id: string) => {
    setState((s) => ({ ...s, deliveries: s.deliveries.filter((d) => d.id !== id) }));
  }, []);

  const addOrder = useCallback((input: DocumentInput & { deliveryDate?: string }) => {
    const id = `o_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const currency = input.currency || "GBP";
      const taxRatePct = input.taxRatePct ?? s.salesSettings.defaultTaxRatePct ?? 0;
      const draftLines: DraftLine[] =
        input.lines && input.lines.length
          ? input.lines
          : [
              {
                id: `ol_${Date.now()}`,
                description: input.title,
                quantity: 1,
                unitPrice: input.total ?? 0,
              },
            ];
      const lines: QuotationLine[] = toQuotationLines(draftLines, currency);
      const totals = computeTotals(lines, taxRatePct);
      const order: Order = {
        id,
        number: nextDocumentNumber(s.salesSettings.orderPrefix || "SO-", s.orders),
        customerId: input.customerId,
        status: "draft",
        lines,
        currency,
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        deliveryDate: input.deliveryDate,
        notes: input.notes ?? input.title,
        createdAt: now,
        updatedAt: now,
      };
      return { ...s, orders: [order, ...s.orders] };
    });
    return id;
  }, []);

  const updateOrder = useCallback((id: string, patch: Partial<Order>) => {
    setState((s) => ({
      ...s,
      orders: s.orders.map((o) =>
        o.id === id ? { ...o, ...patch, updatedAt: new Date().toISOString() } : o,
      ),
    }));
  }, []);

  const updateOrderStatus = useCallback((id: string, status: Order["status"]) => {
    setState((s) => ({
      ...s,
      orders: s.orders.map((o) =>
        o.id === id ? { ...o, status, updatedAt: new Date().toISOString() } : o,
      ),
    }));
  }, []);

  const addOpportunity = useCallback((input: OpportunityInput) => {
    const id = `opp_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const opportunity: Opportunity = {
        id,
        customerId: input.customerId,
        requirementId: input.requirementId || undefined,
        productId: input.productId || undefined,
        supplierId: input.supplierId || undefined,
        title: input.title.trim() || "Opportunity",
        stage: input.stage || "enquiry",
        value: input.value,
        currency: input.currency || "GBP",
        ownerId: input.ownerId || s.user?.id,
        nextAction: input.nextAction || undefined,
        nextActionDue: input.nextActionDue || undefined,
        notes: input.notes || undefined,
        createdAt: now,
        updatedAt: now,
      };
      return { ...s, opportunities: [opportunity, ...s.opportunities] };
    });
    return id;
  }, []);

  const updateOpportunity = useCallback((id: string, patch: Partial<Opportunity>) => {
    setState((s) => ({
      ...s,
      opportunities: s.opportunities.map((o) =>
        o.id === id ? { ...o, ...patch, updatedAt: new Date().toISOString() } : o,
      ),
    }));
  }, []);

  const removeOpportunity = useCallback((id: string) => {
    setState((s) => ({ ...s, opportunities: s.opportunities.filter((o) => o.id !== id) }));
  }, []);

  const updateQuotationStatus = useCallback((id: string, status: Quotation["status"]) => {
    setState((s) => ({
      ...s,
      quotations: s.quotations.map((q) =>
        q.id === id ? { ...q, status, updatedAt: new Date().toISOString() } : q,
      ),
    }));
  }, []);

  const updateOpportunityStage = useCallback((id: string, stage: Opportunity["stage"]) => {
    setState((s) => ({
      ...s,
      opportunities: s.opportunities.map((o) =>
        o.id === id ? { ...o, stage, updatedAt: new Date().toISOString() } : o,
      ),
    }));
  }, []);

  const markInvoicePaid = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      invoices: s.invoices.map((inv) =>
        inv.id === id
          ? {
              ...inv,
              status: "paid" as const,
              amountPaid: inv.total,
              paidAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : inv,
      ),
    }));
  }, []);

  const updateOrganisation = useCallback((patch: Partial<Organisation>) => {
    setState((s) => ({ ...s, organisation: { ...s.organisation, ...patch } }));
  }, []);

  const addUser = useCallback((u: Partial<User>) => {
    const id = `u_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      users: [
        {
          id,
          name: u.name || "New user",
          email: u.email || "",
          role: u.role || "readonly",
          isActive: u.isActive ?? true,
          createdAt: now,
        } as User,
        ...s.users,
      ],
    }));
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<User>) => {
    setState((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }));
  }, []);

  const removeUser = useCallback((id: string) => {
    setState((s) => ({ ...s, users: s.users.filter((u) => u.id !== id) }));
  }, []);

  const updateCrmSettings = useCallback((patch: Partial<CrmSettings>) => {
    setState((s) => ({ ...s, crmSettings: { ...s.crmSettings, ...patch } }));
  }, []);

  const updateSalesSettings = useCallback((patch: Partial<SalesSettings>) => {
    setState((s) => ({ ...s, salesSettings: { ...s.salesSettings, ...patch } }));
  }, []);

  const updateProductSettings = useCallback((patch: Partial<ProductSettings>) => {
    setState((s) => ({ ...s, productSettings: { ...s.productSettings, ...patch } }));
  }, []);

    const runHistoricalEmailScan = useCallback(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 18);
    const cutoffTime = cutoff.getTime();
    let created = 0;
    setState((s) => {
      const received = s.communications.filter(
        (c) =>
          c.channel === "email" &&
          c.isReceived &&
          new Date(c.occurredAt).getTime() >= cutoffTime,
      );
      const knownEmails = new Set(
        s.contacts
          .map((contact) => contact.email?.trim().toLowerCase())
          .filter(Boolean),
      );
      const now = new Date().toISOString();
      const importedContacts = received.flatMap((message, index) => {
        const email = message.from?.trim().toLowerCase();
        if (!email || knownEmails.has(email)) return [];
        knownEmails.add(email);
        const localPart = email.split("@")[0] || "Imported contact";
        const nameParts = localPart
          .replace(/[._-]+/g, " ")
          .split(" ")
          .filter(Boolean);
        created += 1;
        return [{
          id: `ct_scan_${Date.now()}_${index}`,
          firstName: nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : "Imported",
          lastName: nameParts.slice(1).join(" ") || "Contact",
          email,
          jobTitle: "Imported from email scan",
          customerId: message.customerId,
          supplierId: message.supplierId,
          isPrimary: false,
          createdAt: now,
          updatedAt: now,
        } as Contact];
      });
      return {
        ...s,
        contacts: [...importedContacts, ...s.contacts],
      };
    });
    return {
      created,
      message: `Scanned received emails from the last 18 months (since ${cutoff.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}). ${created} new contact(s) created; existing contacts were left unchanged. Pricing data remains in the human review queue.`,
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Finance — expenses, receipts, supplier payments                         */
  /* ---------------------------------------------------------------------- */

  const addExpense = useCallback((input: Partial<Expense>) => {
    const id = `ex_${Date.now()}`;
    setState((s) => {
      const expense: Expense = {
        id,
        date: input.date ?? new Date().toISOString(),
        description: input.description ?? "Expense",
        category: input.category ?? "other",
        supplierId: input.supplierId,
        supplierName:
          input.supplierName ?? s.suppliers.find((sp) => sp.id === input.supplierId)?.name,
        net: input.net ?? 0,
        vat: input.vat ?? 0,
        currency: input.currency ?? s.organisation.defaultCurrency,
        reference: input.reference,
        orderId: input.orderId,
        productId: input.productId,
        isPaid: input.isPaid ?? false,
        paidAt: input.paidAt,
        createdAt: new Date().toISOString(),
      };
      return { ...s, expenses: [expense, ...s.expenses] };
    });
    return id;
  }, []);

  const updateExpense = useCallback((id: string, patch: Partial<Expense>) => {
    setState((s) => ({
      ...s,
      expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const removeExpense = useCallback((id: string) => {
    setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
  }, []);

  const recordReceipt = useCallback(
    (input: {
      invoiceId: string;
      amount: number;
      method?: Payment["method"];
      reference?: string;
      paidAt?: string;
      notes?: string;
    }) => {
      const id = `pay_${Date.now()}`;
      let ok = false;
      setState((s) => {
        const invoice = s.invoices.find((i) => i.id === input.invoiceId);
        if (!invoice || input.amount <= 0) return s;
        ok = true;
        const paidAt = input.paidAt ?? new Date().toISOString();
        const payment: Payment = {
          id,
          direction: "in",
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          amount: input.amount,
          currency: invoice.currency,
          method: input.method ?? "bank_transfer",
          reference: input.reference,
          notes: input.notes,
          paidAt,
          createdBy: s.user?.id,
          createdAt: new Date().toISOString(),
        };
        // Allocation and invoice status move together — a receipt that didn't
        // update the invoice would leave the ledger and the sales view telling
        // different stories about the same money.
        const alreadyPaid = invoice.amountPaid ?? 0;
        const nowPaid = alreadyPaid + input.amount;
        const settled = nowPaid >= invoice.total - 0.01;
        return {
          ...s,
          payments: [payment, ...s.payments],
          invoices: s.invoices.map((i) =>
            i.id === invoice.id
              ? {
                  ...i,
                  amountPaid: nowPaid,
                  status: settled ? ("paid" as const) : ("partial" as const),
                  paidAt: settled ? paidAt : i.paidAt,
                  updatedAt: new Date().toISOString(),
                }
              : i,
          ),
        };
      });
      return ok ? id : null;
    },
    [],
  );

  const recordSupplierPayment = useCallback(
    (input: {
      expenseId: string;
      amount: number;
      method?: Payment["method"];
      reference?: string;
      paidAt?: string;
    }) => {
      const id = `pay_${Date.now()}`;
      let ok = false;
      setState((s) => {
        const expense = s.expenses.find((e) => e.id === input.expenseId);
        if (!expense || input.amount <= 0) return s;
        ok = true;
        const paidAt = input.paidAt ?? new Date().toISOString();
        const payment: Payment = {
          id,
          direction: "out",
          expenseId: expense.id,
          supplierId: expense.supplierId,
          amount: input.amount,
          currency: expense.currency,
          method: input.method ?? "bank_transfer",
          reference: input.reference,
          paidAt,
          createdBy: s.user?.id,
          createdAt: new Date().toISOString(),
        };
        return {
          ...s,
          payments: [payment, ...s.payments],
          expenses: s.expenses.map((e) =>
            e.id === expense.id ? { ...e, isPaid: true, paidAt } : e,
          ),
        };
      });
      return ok ? id : null;
    },
    [],
  );

  /* ---------------------------------------------------------------------- */
  /* Campaigns / mass mailing                                                */
  /* ---------------------------------------------------------------------- */

  const resolveAudience = useCallback(
    (audience: CampaignAudience): CampaignRecipient[] => {
      const out: CampaignRecipient[] = [];
      const seen = new Set<string>();
      const push = (r: CampaignRecipient) => {
        const key = r.email.toLowerCase();
        // One message per address, even where a contact and their company
        // share it — a duplicate send is the fastest way to look amateur.
        if (!r.email || seen.has(key)) return;
        seen.add(key);
        out.push(r);
      };

      const recentEnough = (lastOrderAt?: string) => {
        if (!audience.minRecencyDays) return true;
        if (!lastOrderAt) return true;
        const days = (Date.now() - new Date(lastOrderAt).getTime()) / 86400000;
        return days >= audience.minRecencyDays;
      };

      const matchesList = (value: string | undefined, list?: string[]) =>
        !list || list.length === 0 || (value != null && list.includes(value));

      if (audience.target === "customers") {
        for (const c of state.customers) {
          if (!matchesList(c.status, audience.statuses)) continue;
          if (!matchesList(c.segment, audience.segments as string[] | undefined)) continue;
          if (!matchesList(c.territory, audience.territories)) continue;
          if (!matchesList(c.country, audience.countries)) continue;
          if (audience.tags?.length && !audience.tags.some((t) => c.tags.includes(t))) continue;
          if (audience.kycApprovedOnly && c.kycStatus !== "approved") continue;
          if (!recentEnough(c.lastOrderAt)) continue;
          push({
            id: `rc_${c.id}`,
            name: c.name,
            email: c.email ?? "",
            entityId: c.id,
            entityType: "customer",
            delivered: false,
            opened: false,
            clicked: false,
            bounced: false,
          });
        }
      } else if (audience.target === "suppliers") {
        for (const sp of state.suppliers) {
          if (!matchesList(sp.status, audience.statuses)) continue;
          if (!matchesList(sp.country, audience.countries)) continue;
          if (audience.tags?.length && !audience.tags.some((t) => sp.tags.includes(t))) continue;
          push({
            id: `rc_${sp.id}`,
            name: sp.name,
            email: sp.email ?? "",
            entityId: sp.id,
            entityType: "supplier",
            delivered: false,
            opened: false,
            clicked: false,
            bounced: false,
          });
        }
      } else {
        for (const ct of state.contacts) {
          const parent =
            state.customers.find((c) => c.id === ct.customerId) ??
            state.suppliers.find((sp) => sp.id === ct.supplierId);
          if (audience.statuses?.length && !matchesList(parent?.status, audience.statuses)) continue;
          if (audience.countries?.length && !matchesList(parent?.country, audience.countries)) continue;
          push({
            id: `rc_${ct.id}`,
            name: `${ct.firstName} ${ct.lastName}`.trim(),
            email: ct.email ?? "",
            entityId: ct.id,
            entityType: "contact",
            delivered: false,
            opened: false,
            clicked: false,
            bounced: false,
          });
        }
      }
      return out;
    },
    [state.customers, state.suppliers, state.contacts],
  );

  const addCampaign = useCallback((input: Partial<Campaign>) => {
    const id = `cp_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const campaign: Campaign = {
        id,
        name: input.name || "Untitled campaign",
        status: input.status ?? "draft",
        subject: input.subject ?? "",
        preheader: input.preheader,
        templateBody: input.templateBody ?? "",
        audience: input.audience ?? { target: "customers" },
        recipients: input.recipients ?? [],
        recipientCount: input.recipientCount ?? 0,
        sentCount: 0,
        openCount: 0,
        clickCount: 0,
        bounceCount: 0,
        attachPortfolio: input.attachPortfolio,
        scheduledAt: input.scheduledAt,
        createdBy: s.user?.id,
        createdAt: now,
        updatedAt: now,
      };
      return { ...s, campaigns: [campaign, ...s.campaigns] };
    });
    return id;
  }, []);

  const updateCampaign = useCallback((id: string, patch: Partial<Campaign>) => {
    setState((s) => ({
      ...s,
      campaigns: s.campaigns.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
      ),
    }));
  }, []);

  const removeCampaign = useCallback((id: string) => {
    setState((s) => ({ ...s, campaigns: s.campaigns.filter((c) => c.id !== id) }));
  }, []);

  const sendCampaign = useCallback((id: string) => {
    let sent = 0;
    let message = "Campaign not found.";
    setState((s) => {
      const campaign = s.campaigns.find((c) => c.id === id);
      if (!campaign) return s;
      if (campaign.status === "sent") {
        message = "This campaign has already been sent.";
        return s;
      }

      // Resolve against live data at send time, not whatever was counted when
      // the draft was written — accounts change between drafting and sending.
      const audience = campaign.audience;
      const recipients: CampaignRecipient[] = [];
      const pool =
        audience.target === "customers"
          ? s.customers.map((c) => ({ id: c.id, name: c.name, email: c.email, type: "customer" as const }))
          : audience.target === "suppliers"
            ? s.suppliers.map((sp) => ({ id: sp.id, name: sp.name, email: sp.email, type: "supplier" as const }))
            : s.contacts.map((ct) => ({
                id: ct.id,
                name: `${ct.firstName} ${ct.lastName}`.trim(),
                email: ct.email,
                type: "contact" as const,
              }));

      const chosen = new Set(campaign.recipients.map((r) => r.entityId));
      for (const p of pool) {
        if (chosen.size && !chosen.has(p.id)) continue;
        if (!p.email) continue;
        recipients.push({
          id: `rc_${p.id}`,
          name: p.name,
          email: p.email,
          entityId: p.id,
          entityType: p.type,
          delivered: true,
          opened: false,
          clicked: false,
          bounced: false,
        });
      }

      const now = new Date().toISOString();
      const org = s.organisation;

      // Every send lands in the recipient's own timeline, so the account page
      // and the mailbox show the same history rather than diverging.
      const messages: Communication[] = recipients.map((r, i) => ({
        id: `cm_cp_${Date.now()}_${i}`,
        channel: "email",
        direction: "outbound",
        folder: "sent",
        subject: campaign.subject,
        body: renderTemplate(campaign.templateBody, r.name, s.user?.name ?? org.legalName),
        from: org.email || "marketing@rensogroup.com",
        fromName: s.user?.name,
        to: r.email,
        customerId: r.entityType === "customer" ? r.entityId : undefined,
        supplierId: r.entityType === "supplier" ? r.entityId : undefined,
        contactId: r.entityType === "contact" ? r.entityId : undefined,
        relatedEntityType: "campaign",
        relatedEntityId: campaign.id,
        isReceived: false,
        isRead: true,
        occurredAt: now,
        createdAt: now,
      }));

      sent = recipients.length;
      message =
        sent === 0
          ? "No recipients matched this audience — nothing was sent."
          : `Sent to ${sent} recipient${sent === 1 ? "" : "s"}. Each message is filed in Sent and on the account timeline.`;

      return {
        ...s,
        communications: [...messages, ...s.communications],
        campaigns: s.campaigns.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "sent" as const,
                recipients,
                recipientCount: recipients.length,
                sentCount: recipients.length,
                openCount: 0,
                clickCount: 0,
                bounceCount: 0,
                sentAt: now,
                updatedAt: now,
              }
            : c,
        ),
      };
    });
    return { sent, message };
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Mailbox                                                                 */
  /* ---------------------------------------------------------------------- */

  const patchCommunication = useCallback(
    (id: string, patch: Partial<Communication>) => {
      setState((s) => ({
        ...s,
        communications: s.communications.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }));
    },
    [],
  );

  const markCommunicationRead = useCallback(
    (id: string, isRead = true) => patchCommunication(id, { isRead }),
    [patchCommunication],
  );

  const toggleCommunicationStar = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      communications: s.communications.map((c) =>
        c.id === id ? { ...c, isStarred: !c.isStarred } : c,
      ),
    }));
  }, []);

  const toggleCommunicationFlag = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      communications: s.communications.map((c) =>
        c.id === id ? { ...c, isFlagged: !c.isFlagged } : c,
      ),
    }));
  }, []);

  const moveCommunication = useCallback(
    (id: string, folder: MailFolder) => patchCommunication(id, { folder }),
    [patchCommunication],
  );

  const sendCommunication = useCallback((input: ComposeInput) => {
    const id = `cm_${Date.now()}`;
    const now = new Date().toISOString();
    setState((s) => {
      const message: Communication = {
        id,
        threadId: input.threadId,
        channel: input.channel ?? "email",
        direction: "outbound",
        folder: input.asDraft ? "drafts" : "sent",
        subject: input.subject,
        body: input.body,
        // WhatsApp is addressed by number, not mailbox. Stamping an email
        // address on a chat message makes the conversation look like it came
        // from a different party than every other message in the thread.
        from:
          input.channel === "whatsapp"
            ? s.organisation.phone || "+44 7700 900418"
            : s.organisation.email || "trading@rensogroup.com",
        fromName: s.user?.name,
        to: input.to,
        cc: input.cc,
        customerId: input.customerId,
        supplierId: input.supplierId,
        contactId: input.contactId,
        quotationId: input.quotationId,
        orderId: input.orderId,
        invoiceId: input.invoiceId,
        // Outbound mail is never a candidate for extraction — we already hold
        // the commercial terms we sent.
        isReceived: false,
        isRead: true,
        occurredAt: now,
        createdAt: now,
      };
      return { ...s, communications: [message, ...s.communications] };
    });
    return id;
  }, []);

  const fileAttachment = useCallback((communicationId: string, attachmentId: string) => {
    const docId = `doc_${Date.now()}`;
    let filed = false;
    setState((s) => {
      const message = s.communications.find((c) => c.id === communicationId);
      const attachment = message?.attachments?.find((a) => a.id === attachmentId);
      // Already filed, or nothing to file — leave state untouched so the caller
      // doesn't get a duplicate document for a second click.
      if (!message || !attachment || attachment.documentId) return s;
      filed = true;
      const doc: Document = {
        id: docId,
        name: attachment.name,
        type: inferDocumentType(attachment.name),
        mimeType: attachment.mimeType,
        size: attachment.size,
        customerId: message.customerId,
        supplierId: message.supplierId,
        source: "email",
        uploadedBy: s.user?.id,
        createdAt: new Date().toISOString(),
      };
      return {
        ...s,
        documents: [doc, ...s.documents],
        communications: s.communications.map((c) =>
          c.id === communicationId
            ? {
                ...c,
                attachments: c.attachments?.map((a) =>
                  a.id === attachmentId ? { ...a, documentId: docId } : a,
                ),
              }
            : c,
        ),
      };
    });
    return filed ? docId : null;
  }, []);

  /* --- Intelligence layer settings -------------------------------------- */

  const updateFxRates = useCallback((rates: FxRate[]) => {
    setState((s) => ({ ...s, fx: { ...s.fx, rates } }));
  }, []);

  const setReportingCurrency = useCallback((currency: string) => {
    setState((s) => {
      // Re-basing the table means re-expressing every rate against the new
      // base, not just relabelling it. Doing the arithmetic here keeps every
      // consumer of `fx` ignorant of which currency happens to be the base.
      if (currency === s.fx.base) return s;
      const pivot = s.fx.rates.find((r) => r.currency === currency);
      if (!pivot || pivot.perBase <= 0) return s;
      const rebased: FxRate[] = [
        { currency: s.fx.base, perBase: 1 / pivot.perBase, asOf: pivot.asOf },
        ...s.fx.rates
          .filter((r) => r.currency !== currency)
          .map((r) => ({ ...r, perBase: r.perBase / pivot.perBase })),
      ];
      return { ...s, fx: { base: currency, rates: rebased } };
    });
  }, []);

  const updateTradeSettings = useCallback((patch: Partial<TradeSettings>) => {
    setState((s) => ({ ...s, tradeSettings: { ...s.tradeSettings, ...patch } }));
  }, []);

  const dismissSignal = useCallback((id: string) => {
    setState((s) =>
      s.dismissedSignals.includes(id)
        ? s
        : { ...s, dismissedSignals: [...s.dismissedSignals, id] },
    );
  }, []);

  const restoreSignals = useCallback(() => {
    setState((s) => (s.dismissedSignals.length ? { ...s, dismissedSignals: [] } : s));
  }, []);

  const extractFromCommunication = useCallback((id: string) => {
    const recordId = `pr_${Date.now()}`;
    let created = false;
    setState((s) => {
      const message = s.communications.find((c) => c.id === id);
      // Only received messages are ever extracted, and never twice.
      if (!message || !message.isReceived || message.extracted) return s;
      const parsed = parseCommercialTerms(message.body);
      if (parsed.unitPrice == null) return s;
      created = true;
      const supplier = s.suppliers.find((sp) => sp.id === message.supplierId);
      const product = s.products.find((p) => p.id === message.productId);
      const now = new Date().toISOString();
      const record: PricingRecord = {
        id: recordId,
        productId: message.productId,
        productName: product?.name || parsed.productName || message.subject || "Unidentified product",
        supplierId: message.supplierId,
        supplierName: supplier?.name || message.fromName || message.from || "Unknown supplier",
        quantity: parsed.quantity,
        unitPrice: parsed.unitPrice,
        currency: parsed.currency || supplier?.currency || "USD",
        deliveryInfo: parsed.deliveryInfo,
        commercialTerms: parsed.commercialTerms,
        source: message.channel === "whatsapp" ? "whatsapp" : "email",
        sourceRef: message.subject || message.id,
        // Extraction never auto-approves. A human signs off in the review queue.
        status: "pending_review",
        extractedAt: now,
        originalText: message.body,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...s,
        pricingRecords: [record, ...s.pricingRecords],
        communications: s.communications.map((c) =>
          c.id === id ? { ...c, extracted: true } : c,
        ),
      };
    });
    return created ? recordId : null;
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      signIn,
      continueAsGuest,
      signOut,
      getMetrics,
      approvePricing,
      rejectPricing,
      updatePricing,
      addCustomer,
      updateCustomer,
      removeCustomer,
      addSupplier,
      updateSupplier,
      removeSupplier,
      addContact,
      addProduct,
      updateProduct,
      removeProduct,
      addDocument,
      updateDocument,
      removeDocument,
      updateKycStatus,
      convertQuotationToOrder,
      convertOrderToInvoice,
      updateKycNotes,
      addRequirement,
      updateRequirement,
      removeRequirement,
      matchRequirement,
      addDelivery,
      markDeliveryArrived,
      removeDelivery,
      addQuotation,
      updateQuotation,
      updateQuotationStatus,
      addOrder,
      updateOrder,
      updateOrderStatus,
      addOpportunity,
      updateOpportunity,
      removeOpportunity,
      updateOpportunityStage,
      markInvoicePaid,
      runHistoricalEmailScan,
      addExpense,
      updateExpense,
      removeExpense,
      recordReceipt,
      recordSupplierPayment,
      resolveAudience,
      addCampaign,
      updateCampaign,
      removeCampaign,
      sendCampaign,
      markCommunicationRead,
      toggleCommunicationStar,
      toggleCommunicationFlag,
      moveCommunication,
      sendCommunication,
      fileAttachment,
      extractFromCommunication,
      updateOrganisation,
      addUser,
      updateUser,
      removeUser,
      updateCrmSettings,
      updateSalesSettings,
      updateProductSettings,
      updateFxRates,
      setReportingCurrency,
      updateTradeSettings,
      dismissSignal,
      restoreSignals,
    }),
    [state, signIn, continueAsGuest, signOut, getMetrics, approvePricing, rejectPricing, updatePricing, addCustomer, updateCustomer, removeCustomer, addSupplier, updateSupplier, removeSupplier, addContact, addProduct, updateProduct, removeProduct, addDocument, updateDocument, removeDocument, updateKycStatus, convertQuotationToOrder, convertOrderToInvoice, addQuotation, updateQuotation, updateQuotationStatus, addOrder, updateOrder, updateOrderStatus, updateKycNotes, addRequirement, updateRequirement, removeRequirement, matchRequirement, addDelivery, markDeliveryArrived, removeDelivery, addOpportunity, updateOpportunity, removeOpportunity, updateOpportunityStage, markInvoicePaid, runHistoricalEmailScan, addExpense, updateExpense, removeExpense, recordReceipt, recordSupplierPayment, resolveAudience, addCampaign, updateCampaign, removeCampaign, sendCampaign, markCommunicationRead, toggleCommunicationStar, toggleCommunicationFlag, moveCommunication, sendCommunication, fileAttachment, extractFromCommunication, updateOrganisation, addUser, updateUser, removeUser, updateCrmSettings, updateSalesSettings, updateProductSettings, updateFxRates, setReportingCurrency, updateTradeSettings, dismissSignal, restoreSignals],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
