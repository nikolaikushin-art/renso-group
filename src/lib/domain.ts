/**
 * Renso Group CRM — Domain Model
 * London-based trading company (843 Finchley Rd, London, NW11 8NA)
 * Focus: supplier pricing intelligence, commercial extraction, CRM.
 */

export type UUID = string;

export type Role =
  | "administrator"
  | "management"
  | "commercial"
  | "sales"
  | "finance"
  | "operations"
  | "readonly";

export type Permission =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "export"
  | "approve"
  | "send"
  | "manage_integrations"
  | "manage_users"
  | "manage_settings";

export const ROLE_LABELS: Record<Role, string> = {
  administrator: "Administrator",
  management: "Management",
  commercial: "Commercial",
  sales: "Sales",
  finance: "Finance",
  operations: "Operations",
  readonly: "Read Only",
};

/* -------------------------------------------------------------------------- */
/* Core entities                                                              */
/* -------------------------------------------------------------------------- */

export interface User {
  id: UUID;
  email: string;
  name: string;
  role: Role;
  avatarUrl?: string;
  createdAt: string;
  lastLoginAt?: string;
  isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/* Organisation & configuration                                               */
/* -------------------------------------------------------------------------- */

export interface Organisation {
  legalName: string;
  tradingName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country: string;
  vatNumber?: string;
  registrationNumber?: string;
  defaultCurrency: string;
  phone?: string;
  email?: string;
  website?: string;
}

export interface CrmSettings {
  leadSources: string[];
  customerSegments: string[];
  /** Territories offered when assigning a customer. Free-form so the list can
   *  be reshaped per market without a code change. */
  salesTerritories: string[];
  defaultOwnerId?: UUID;
  requireKycForOnboarding: boolean;
  followUpReminderDays: number;
  /** How many days before `Document.expiresAt` a document counts as expiring. */
  documentExpiryWarningDays: number;
}

export interface SalesSettings {
  quotationPrefix: string;
  quotationValidityDays: number;
  orderPrefix: string;
  defaultPaymentTerms: string;
  defaultTaxRatePct: number;
  requireApprovalAboveAmount?: number;
}

/**
 * Defaults for the landed-cost calculator and the margin floor used by the
 * deal desk. These live in settings rather than in the component because they
 * are commercial policy — the freight and duty a trading company assumes, and
 * the margin below which a quotation needs a reason.
 */
export interface TradeSettings {
  /** Assumed import duty on goods value, as a percentage. */
  defaultDutyPct: number;
  /** Assumed insurance on goods value, as a percentage. */
  defaultInsurancePct: number;
  /** Typical freight for a consignment, in `freightCurrency`. */
  defaultFreightTotal: number;
  freightCurrency: string;
  /** Margin the desk aims for when solving a selling price. */
  targetMarginPct: number;
  /** Price move, in percent over the window, that is worth a signal. */
  priceAlertThresholdPct: number;
}

export interface ProductSettings {
  categories: string[];
  units: string[];
  defaultCurrency: string;
  lowMarginThresholdPct: number;
}

export interface Contact {
  id: UUID;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  jobTitle?: string;
  isPrimary: boolean;
  notes?: string;
  customerId?: UUID;
  supplierId?: UUID;
  createdAt: string;
  updatedAt: string;
}

export type CustomerStatus = "lead" | "active" | "inactive" | "onboarding" | "blocked";
export type CustomerSegment = "wholesale" | "retail" | "distributor" | "end_user" | "other";

export interface Customer {
  id: UUID;
  name: string;
  tradingName?: string;
  status: CustomerStatus;
  segment: CustomerSegment;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country: string;
  vatNumber?: string;
  companyNumber?: string;
  paymentTerms?: string;
  creditLimit?: number;
  currency: string;
  tags: string[];
  notes?: string;
  /**
   * Relationship manager — the person who owns this account commercially.
   * A separate `relationshipManagerId` was considered and rejected: it would
   * duplicate this field with no behavioural difference. The UI labels it
   * "Relationship manager".
   */
  ownerId?: UUID;
  /** Sales territory, drawn from `CrmSettings.salesTerritories`. */
  territory?: string;
  kycStatus: "none" | "pending" | "approved" | "rejected" | "expired";
  relationshipScore?: number;
  totalRevenue?: number;
  totalOrders?: number;
  lastOrderAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: UUID;
}

export type SupplierStatus = "active" | "inactive" | "preferred" | "blocked";

export interface Supplier {
  id: UUID;
  name: string;
  tradingName?: string;
  status: SupplierStatus;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  city?: string;
  postcode?: string;
  country: string;
  vatNumber?: string;
  paymentTerms?: string;
  currency: string;
  tags: string[];
  notes?: string;
  /** Relationship manager — the person who owns this supplier commercially. */
  ownerId?: UUID;
  relationshipScore?: number;
  totalSpend?: number;
  totalOrders?: number;
  priceCompetitiveness?: number;
  deliveryPerformance?: number;
  lastOfferAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: UUID;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  packaging?: string;
  specifications?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  currency: string;
  supplierIds: UUID[];
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Pricing Intelligence (core differentiator)                                 */
/* -------------------------------------------------------------------------- */

export type OfferStatus = "draft" | "pending_review" | "approved" | "rejected" | "expired" | "converted";
export type ExtractionSource = "email" | "whatsapp" | "pdf" | "excel" | "manual";

export interface PricingRecord {
  id: UUID;
  productId?: UUID;
  productName: string;
  supplierId?: UUID;
  supplierName: string;
  quantity?: number;
  unitPrice: number;
  currency: string;
  deliveryInfo?: string;
  commercialTerms?: string;
  validUntil?: string;
  source: ExtractionSource;
  sourceRef?: string; // email id / file name
  status: OfferStatus;
  extractedAt: string;
  approvedAt?: string;
  approvedBy?: UUID;
  originalText?: string;
  customFields?: Record<string, string | number>;
  createdAt: string;
  updatedAt: string;
}

export interface AiExtractionJob {
  id: UUID;
  source: ExtractionSource;
  sourceRef: string;
  originalContent: string;
  status: "queued" | "processing" | "pending_review" | "approved" | "rejected";
  extractedRecords: PricingRecord[];
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: UUID;
}

/* -------------------------------------------------------------------------- */
/* Requirements, Opportunities, Sales                                         */
/* -------------------------------------------------------------------------- */

export type RequirementStatus = "open" | "matching" | "quoted" | "won" | "lost" | "cancelled";

export interface CustomerRequirement {
  id: UUID;
  customerId: UUID;
  productName: string;
  productId?: UUID;
  quantity?: number;
  specification?: string;
  destination?: string;
  deliveryRequirements?: string;
  timing?: string;
  commercialRequirements?: string;
  status: RequirementStatus;
  ownerId?: UUID;
  matchedSupplierIds: UUID[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type OpportunityStage =
  | "enquiry"
  | "quotation"
  | "order"
  | "delivery"
  | "invoice"
  | "payment"
  | "closed_won"
  | "closed_lost";

export interface Opportunity {
  id: UUID;
  customerId: UUID;
  requirementId?: UUID;
  productId?: UUID;
  supplierId?: UUID;
  pricingRecordId?: UUID;
  title: string;
  stage: OpportunityStage;
  value?: number;
  currency: string;
  ownerId?: UUID;
  nextAction?: string;
  nextActionDue?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type QuotationStatus = "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired" | "converted";

export interface QuotationLine {
  id: UUID;
  productId?: UUID;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  discountPct?: number;
}

export interface Quotation {
  id: UUID;
  number: string;
  customerId: UUID;
  opportunityId?: UUID;
  status: QuotationStatus;
  lines: QuotationLine[];
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  validUntil?: string;
  notes?: string;
  sentAt?: string;
  followUpAt?: string;
  convertedOrderId?: UUID;
  createdAt: string;
  updatedAt: string;
  createdBy?: UUID;
}

export type OrderStatus = "draft" | "confirmed" | "in_progress" | "shipped" | "delivered" | "cancelled";

export interface Order {
  id: UUID;
  number: string;
  customerId: UUID;
  quotationId?: UUID;
  status: OrderStatus;
  lines: QuotationLine[];
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  deliveryDate?: string;
  /** Agreed shipping terms, carried onto the delivery note and the invoice. */
  incoterms?: string;
  deliveryAddress?: string;
  customerReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A despatch against an order.
 *
 * Deliveries are separate records rather than fields on the order because a
 * single order is routinely shipped in parts — the case the old single
 * "delivery date" field could not express, and the reason the order → delivery
 * → invoice step had nothing real behind it.
 */
export interface Delivery {
  id: UUID;
  orderId: UUID;
  reference: string;
  /** Quantity despatched per order line, keyed by line id. */
  quantities: Record<UUID, number>;
  carrier?: string;
  trackingRef?: string;
  despatchedAt: string;
  deliveredAt?: string;
  incoterms?: string;
  destination?: string;
  notes?: string;
  createdAt: string;
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "overdue" | "cancelled" | "partial";

export interface Invoice {
  id: UUID;
  number: string;
  customerId: UUID;
  orderId?: UUID;
  status: InvoiceStatus;
  lines: QuotationLine[];
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  amountPaid?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseCategory =
  | "purchases"
  | "freight_duty"
  | "salaries"
  | "premises"
  | "professional_fees"
  | "marketing"
  | "travel"
  | "software"
  | "bank_charges"
  | "other";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  purchases: "Purchases / cost of goods",
  freight_duty: "Freight & duty",
  salaries: "Salaries & staff",
  premises: "Premises",
  professional_fees: "Professional fees",
  marketing: "Marketing",
  travel: "Travel & subsistence",
  software: "Software & IT",
  bank_charges: "Bank charges",
  other: "Other",
};

/**
 * A purchase or overhead. `category` drives where it lands in the P&L:
 * `purchases` and `freight_duty` are cost of sales, everything else is an
 * operating expense. Keeping that mapping in one place is what lets gross
 * profit be a measured figure rather than an assumption.
 */
export interface Expense {
  id: UUID;
  date: string;
  description: string;
  category: ExpenseCategory;
  supplierId?: UUID;
  supplierName?: string;
  /** Net of recoverable VAT. */
  net: number;
  vat: number;
  currency: string;
  reference?: string;
  /** Links the cost back to what it was incurred for. */
  orderId?: UUID;
  productId?: UUID;
  isPaid: boolean;
  paidAt?: string;
  createdAt: string;
}

export type PaymentDirection = "in" | "out";

export interface Payment {
  id: UUID;
  /** Money received against a sales invoice, or paid out against an expense. */
  direction: PaymentDirection;
  invoiceId?: UUID;
  expenseId?: UUID;
  customerId?: UUID;
  supplierId?: UUID;
  amount: number;
  currency: string;
  method?: "bank_transfer" | "card" | "cash" | "cheque" | "other";
  reference?: string;
  notes?: string;
  paidAt: string;
  createdBy?: UUID;
  createdAt: string;
}

export const PAYMENT_METHOD_LABELS: Record<
  NonNullable<Payment["method"]>,
  string
> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  cheque: "Cheque",
  other: "Other",
};

/* -------------------------------------------------------------------------- */
/* Communications & Documents                                                 */
/* -------------------------------------------------------------------------- */

export type CommChannel = "email" | "whatsapp" | "note" | "call" | "system";
export type CommDirection = "inbound" | "outbound" | "internal";

/** Where a message sits in the mailbox. Derived folders (starred, flagged) are
 *  computed from flags rather than stored, so a message is only ever in one. */
export type MailFolder = "inbox" | "sent" | "drafts" | "archive";

export interface MailAttachment {
  id: UUID;
  name: string;
  mimeType?: string;
  size?: number;
  /** Set once the attachment has been filed into Documents. */
  documentId?: UUID;
}

export interface Communication {
  id: UUID;
  channel: CommChannel;
  direction: CommDirection;
  subject?: string;
  body: string;
  from?: string;
  fromName?: string;
  to?: string;
  cc?: string;
  customerId?: UUID;
  supplierId?: UUID;
  contactId?: UUID;
  opportunityId?: UUID;
  /** Links to the commercial record this message is about, so the reading pane
   *  can show (and open) the quotation/order/invoice it refers to. */
  quotationId?: UUID;
  orderId?: UUID;
  invoiceId?: UUID;
  productId?: UUID;
  pricingRecordId?: UUID;
  relatedEntityType?: string;
  relatedEntityId?: UUID;
  isReceived: boolean; // for extraction rule: only received
  /** Mail client state. Optional so older records keep working. */
  folder?: MailFolder;
  isRead?: boolean;
  isStarred?: boolean;
  isFlagged?: boolean;
  /** Messages sharing a threadId render as one conversation. */
  threadId?: UUID;
  attachments?: MailAttachment[];
  /** True when AI extraction has already pulled commercial terms out of this
   *  message — prevents the same offer being banked twice. */
  extracted?: boolean;
  occurredAt: string;
  createdAt: string;
}

export interface Document {
  id: UUID;
  name: string;
  type: "contract" | "quotation" | "order" | "invoice" | "kyc" | "certificate" | "correspondence" | "other";
  /** Issuer's own reference — certificate number, contract number, policy number. */
  reference?: string;
  /** When the document was issued by its originator (not when it was uploaded). */
  issuedAt?: string;
  /** When it stops being valid. Absent means the document does not expire. */
  expiresAt?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  customerId?: UUID;
  supplierId?: UUID;
  productId?: UUID;
  opportunityId?: UUID;
  kycRecordId?: UUID;
  source?: string;
  uploadedBy?: UUID;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* KYC / Onboarding                                                           */
/* -------------------------------------------------------------------------- */

export type KycStatus = "draft" | "sent" | "submitted" | "under_review" | "approved" | "rejected" | "changes_requested";

export interface KycRecord {
  id: UUID;
  customerId: UUID;
  status: KycStatus;
  secureToken?: string;
  submittedData?: Record<string, unknown>;
  reviewNotes?: string;
  reviewedBy?: UUID;
  reviewedAt?: string;
  sentAt?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Campaigns, Audit, Activity                                                 */
/* -------------------------------------------------------------------------- */

/** Rules that resolve to a recipient list at send time, so a segment stays
 *  live rather than freezing a snapshot of contacts taken when it was built. */
export interface CampaignAudience {
  /** Which side of the book to mail. */
  target: "customers" | "suppliers" | "contacts";
  statuses?: string[];
  segments?: CustomerSegment[];
  territories?: string[];
  countries?: string[];
  tags?: string[];
  /** Exclude accounts with no order in this many days (0 = no rule). */
  minRecencyDays?: number;
  /** Exclude anyone whose KYC is not approved. */
  kycApprovedOnly?: boolean;
}

export interface CampaignRecipient {
  id: UUID;
  name: string;
  email: string;
  entityId: UUID;
  entityType: "customer" | "supplier" | "contact";
  delivered: boolean;
  opened: boolean;
  clicked: boolean;
  bounced: boolean;
}

export interface Campaign {
  id: UUID;
  name: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  subject: string;
  preheader?: string;
  templateBody: string;
  /** Free-text description kept for older records; `audience` is authoritative. */
  segmentFilter?: string;
  audience: CampaignAudience;
  recipients: CampaignRecipient[];
  recipientCount: number;
  sentCount: number;
  openCount?: number;
  clickCount?: number;
  bounceCount?: number;
  /** Attach a generated product portfolio or price list to the send. */
  attachPortfolio?: boolean;
  scheduledAt?: string;
  sentAt?: string;
  createdBy?: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: UUID;
  userId: UUID;
  userName: string;
  entityType: string;
  entityId: UUID;
  action: string;
  previousValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface Activity {
  id: UUID;
  type: string;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: UUID;
  userId?: UUID;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboard metrics helpers                                                  */
/* -------------------------------------------------------------------------- */

export interface DashboardMetrics {
  totalRevenue: number;
  grossProfit: number;
  netProfit: number;
  openOpportunities: number;
  pendingKyc: number;
  newOffers: number;
  activeRequirements: number;
  followUpsDue: number;
  /** Documents inside the expiry warning window, and those already lapsed. */
  documentsExpiring: number;
  documentsExpired: number;
  topCustomers: { id: UUID; name: string; revenue: number }[];
  topSuppliers: { id: UUID; name: string; spend: number }[];
  recentPricingChanges: PricingRecord[];
}
