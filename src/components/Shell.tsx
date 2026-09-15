import {
  LayoutDashboard,
  Users,
  Contact,
  Truck,
  Package,
  FileText,
  FileSpreadsheet,
  ClipboardList,
  ShoppingCart,
  Receipt,
  Mail,
  MessageCircle,
  Megaphone,
  ShieldCheck,
  FolderOpen,
  Calculator,
  CreditCard,
  Brain,
  Target,
  BarChart3,
  Settings,
  LogOut,
  Search,
  Bell,
  Moon,
  Sun,
  PanelLeft,
  MoreHorizontal,
  ChevronDown,
  TrendingUp,
  Sparkles,
  Gauge,
  Percent,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BrandGlobe, BrandMark } from "@/components/brand";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";
import { useLiveSignals } from "@/lib/useSignals";
import { LiveCapsule, SeverityDot } from "@/components/apple";

export type AppSection =
  | "dashboard"
  | "signals"
  | "customers"
  | "contacts"
  | "suppliers"
  | "products"
  | "requirements"
  | "pricing"
  | "priceintel"
  | "portfolio"
  | "opportunities"
  | "dealdesk"
  | "quotations"
  | "orders"
  | "invoices"
  | "email"
  | "whatsapp"
  | "campaigns"
  | "kyc"
  | "documents"
  | "accounting"
  | "payments"
  | "credit"
  | "scoring"
  | "settings";

type NavGroup = {
  label: string;
  items: { id: AppSection; label: string; icon: LucideIcon }[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      // Signals sits directly under the dashboard because it is the page a
      // person should open first: the dashboard says how the business is
      // doing, Signals says what to do about it this morning.
      { id: "signals", label: "Signals", icon: Sparkles },
    ],
  },
  {
    label: "CRM",
    items: [
      { id: "customers", label: "Customers", icon: Users },
      { id: "contacts", label: "Contacts", icon: Contact },
      { id: "suppliers", label: "Suppliers", icon: Truck },
    ],
  },
  {
    label: "Sourcing",
    items: [
      { id: "products", label: "Products", icon: Package },
      { id: "requirements", label: "Requirements", icon: Target },
      { id: "pricing", label: "Pricing & Supplier Offers", icon: Brain },
      { id: "priceintel", label: "Price Intelligence", icon: Activity },
      { id: "portfolio", label: "Product Portfolio", icon: FileSpreadsheet },
    ],
  },
  {
    label: "Sales",
    items: [
      { id: "opportunities", label: "Opportunities", icon: TrendingUp },
      { id: "dealdesk", label: "Deal Desk", icon: Percent },
      { id: "quotations", label: "Quotations", icon: ClipboardList },
      { id: "orders", label: "Orders", icon: ShoppingCart },
      { id: "invoices", label: "Invoices", icon: Receipt },
    ],
  },
  {
    label: "Communications",
    items: [
      { id: "email", label: "Email", icon: Mail },
      { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
      { id: "campaigns", label: "Campaigns", icon: Megaphone },
    ],
  },
  {
    label: "Compliance & Documents",
    items: [
      { id: "kyc", label: "KYC", icon: ShieldCheck },
      { id: "documents", label: "Documents", icon: FolderOpen },
    ],
  },
  {
    label: "Finance",
    items: [
      { id: "accounting", label: "Accounting", icon: Calculator },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "credit", label: "Credit Control", icon: Gauge },
    ],
  },
  {
    label: "Relationship Intelligence",
    items: [
      { id: "scoring", label: "Relationship Scoring", icon: BarChart3 },
    ],
  },
  {
    label: "System",
    items: [{ id: "settings", label: "Settings", icon: Settings }],
  },
];

export const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.items);
export const sectionLabel = (id: AppSection) =>
  ALL_SECTIONS.find((i) => i.id === id)?.label ?? id;
export const sectionGroupLabel = (id: AppSection) =>
  NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.label;

/** Primary mobile tabs — rest under More. Follows the money: overview,
 *  who it's with, what's open, what's being sold right now. */
const MOBILE_PRIMARY: AppSection[] = [
  "dashboard",
  "signals",
  "customers",
  "quotations",
];

const RAIL_KEY = "renso.web.rail";

/**
 * Re-exported from `lib/theme` so existing imports keep working. The hook used
 * to hold its own state here, which meant the sidebar switch and the Settings
 * switch were two different switches fighting over one DOM attribute.
 */
export { useTheme };

export function AppShell({
  section,
  onSelect,
  onOpenSearch,
  children,
}: {
  section: AppSection;
  onSelect: (s: AppSection) => void;
  onOpenSearch: () => void;
  children: ReactNode;
}) {
  const store = useStore();
  const { theme, toggle } = useTheme();
  const signals = useLiveSignals();
  const critical = signals.filter((s) => s.severity === "critical").length;
  const top = signals[0];
  const [railOpen, setRailOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(RAIL_KEY) !== "collapsed";
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("renso.nav.groups");
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    // Default: only the group holding the current page is open, everything
    // else starts collapsed — an iOS-style accordion, not a wall of open lists.
    const activeGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.id === section))?.label;
    return activeGroup ? { [activeGroup]: true } : {};
  });

  /** Accordion: opening a group closes every other one, iOS Settings-style. */
  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = prev[label] ? {} : { [label]: true };
      try {
        localStorage.setItem("renso.nav.groups", JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  /** Keep the active page's group expanded when navigation changes from
   *  elsewhere (global search, dashboard drill-downs) — an accordion should
   *  never hide the page you're actually on. */
  useEffect(() => {
    const activeGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.id === section))?.label;
    if (!activeGroup) return;
    setOpenGroups((prev) => (prev[activeGroup] ? prev : { [activeGroup]: true }));
  }, [section]);

  const toggleRail = useCallback(() => {
    setRailOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem(RAIL_KEY, next ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col bg-canvas lg:flex-row">
      {/* Desktop rail */}
      <nav
        aria-label="Main"
        className={cn(
          "hidden shrink-0 flex-col border-r border-divider bg-canvas lg:flex",
          "transition-[width] duration-200 ease-out",
          railOpen ? "w-[248px]" : "w-[72px]",
        )}
      >
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-divider",
            railOpen ? "gap-2 px-4" : "justify-center px-2",
          )}
        >
          {railOpen ? (
            <BrandMark size="sm" />
          ) : (
            /* Collapsed rail: the globe alone still reads as Renso, where a
               shrunken full lockup would just be a smudge. */
            <span className="h-7 w-7 shrink-0">
              <BrandGlobe />
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={toggleRail}
            className="rounded-lg p-2 text-ink-secondary hover:bg-elevated"
            aria-label={railOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>

                <div className="thin-scroll flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {NAV_GROUPS.map((group) => {
            const isOpen = openGroups[group.label] === true;
            return (
              <div key={group.label} className="mb-1">
                {railOpen ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    className="flex w-full items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary transition-colors hover:text-ink-secondary"
                  >
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-200 ease-out",
                        isOpen ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </button>
                ) : null}
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    isOpen || !railOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="space-y-0.5 overflow-hidden">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = section === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelect(item.id)}
                          title={item.label}
                          className={cn(
                            "w-full flex items-center gap-2.5 rounded-xl text-[13px] transition-colors",
                            railOpen ? "px-2.5 py-1.5" : "justify-center px-2 py-2.5",
                            active
                              ? "nav-active font-semibold"
                              : "text-ink-secondary hover:bg-elevated hover:text-ink",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] transition-colors",
                              active ? "bg-accent text-white" : "bg-elevated text-ink-secondary",
                            )}
                          >
                            <Icon className="h-4 w-4" strokeWidth={active ? 2.25 : 1.75} />
                          </span>
                          {railOpen ? <span className="truncate">{item.label}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-divider p-2 space-y-1">
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-ink-secondary hover:bg-elevated",
              !railOpen && "justify-center px-2",
            )}
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {railOpen ? <span>{theme === "light" ? "Dark mode" : "Light mode"}</span> : null}
          </button>
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-2 py-2",
              !railOpen && "justify-center",
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
              {(store.user?.name || "R").charAt(0)}
            </div>
            {railOpen ? (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{store.user?.name}</div>
                  <div className="truncate text-[11px] text-ink-tertiary capitalize">
                    {store.user?.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => store.signOut()}
                  className="rounded-lg p-1.5 text-ink-secondary hover:bg-elevated"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </nav>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col min-h-0">
        {/* Desktop top bar */}
        <header className="hidden h-14 shrink-0 items-center gap-3 border-b border-divider renso-glass px-6 lg:flex">
          <div className="text-[13px] text-ink-secondary">
            Renso Group
            {sectionGroupLabel(section) ? (
              <>
                <span className="mx-2 text-ink-tertiary">/</span>
                {sectionGroupLabel(section)}
              </>
            ) : null}
            <span className="mx-2 text-ink-tertiary">/</span>
            <span className="font-medium text-ink">
              {sectionLabel(section)}
            </span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-9 w-64 items-center gap-2 rounded-xl border border-divider bg-canvas px-3 text-[13px] text-ink-tertiary hover:border-[rgb(var(--accent))]/40"
          >
            <Search className="h-3.5 w-3.5" />
            Search…
            <kbd className="ml-auto rounded border border-divider px-1.5 text-[10px]">⌘K</kbd>
          </button>
          {/* The top signal, as a Dynamic-Island-style capsule: one glyph at
              rest, expanding on hover or focus to show what it is. The old
              bell here did nothing at all. */}
          {top ? (
            <LiveCapsule
              icon={Bell}
              label={top.title}
              detail={top.action}
              tone={
                top.severity === "critical"
                  ? "--danger"
                  : top.severity === "high"
                    ? "--accent"
                    : "--caution"
              }
              pulse={critical > 0}
              onClick={() => onSelect("signals")}
            />
          ) : null}
          <button
            type="button"
            onClick={() => onSelect("signals")}
            title={
              signals.length
                ? `${signals.length} open signal${signals.length === 1 ? "" : "s"}`
                : "No signals — everything is inside terms"
            }
            className="relative rounded-xl p-2 text-ink-secondary hover:bg-elevated"
          >
            <Bell className="h-4 w-4" />
            {signals.length ? (
              <span className="absolute right-1 top-1">
                <SeverityDot
                  token={critical > 0 ? "--danger" : "--accent"}
                  pulse={critical > 0}
                />
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={toggle}
            className="rounded-xl p-2 text-ink-secondary hover:bg-elevated"
            aria-label="Toggle theme"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </header>

        {/* Mobile top bar */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-divider renso-glass px-3 lg:hidden">
          <BrandMark size="sm" />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onSelect("signals")}
            aria-label="Signals"
            className="relative rounded-lg p-2"
          >
            <Bell className="h-4 w-4 text-ink-secondary" />
            {signals.length ? (
              <span className="absolute right-1 top-1">
                <SeverityDot
                  token={critical > 0 ? "--danger" : "--accent"}
                  pulse={critical > 0}
                />
              </span>
            ) : null}
          </button>
          <button type="button" onClick={onOpenSearch} className="rounded-lg p-2">
            <Search className="h-4 w-4 text-ink-secondary" />
          </button>
          <button type="button" onClick={toggle} className="rounded-lg p-2">
            {theme === "light" ? (
              <Moon className="h-4 w-4 text-ink-secondary" />
            ) : (
              <Sun className="h-4 w-4 text-ink-secondary" />
            )}
          </button>
        </header>

        <main className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-canvas pb-20 lg:pb-0">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Mobile"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-divider renso-glass lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {MOBILE_PRIMARY.map((id) => {
          const item = ALL_SECTIONS.find((i) => i.id === id)!;
          const Icon = item.icon;
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                onSelect(id);
                setMoreOpen(false);
              }}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-accent" : "text-ink-tertiary",
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", active && "stroke-[2.25px]")} />
                {id === "signals" && signals.length ? (
                  <span className="absolute -right-1.5 -top-0.5">
                    <SeverityDot token={critical > 0 ? "--danger" : "--accent"} />
                  </span>
                ) : null}
              </span>
              {item.label.split(" ")[0]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
            moreOpen || !MOBILE_PRIMARY.includes(section)
              ? "text-accent"
              : "text-ink-tertiary",
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>

      {/* Mobile more sheet */}
      {moreOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-surface pb-safe shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-divider bg-surface px-4 py-3">
              <span className="font-semibold">All modules</span>
              <button type="button" onClick={() => setMoreOpen(false)} className="text-sm text-accent">
                Done
              </button>
            </div>
            <div className="p-3 space-y-4 pb-24">
              {NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = section === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onSelect(item.id);
                            setMoreOpen(false);
                          }}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl p-3 text-[11px]",
                            active
                              ? "bg-accent text-white"
                              : "bg-canvas text-ink-secondary",
                          )}
                        >
                          <Icon className="h-5 w-5" />
                          <span className="text-center leading-tight">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => store.signOut()}
                className="w-full rounded-xl border border-divider py-3 text-sm font-medium text-ink-secondary"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Sticky page header used by modules */
export function PageHeader({
  title,
  subtitle,
  toolbar,
}: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-divider renso-glass">
      <div className="mx-auto flex min-h-[56px] max-w-[1400px] items-center gap-3 px-4 py-3 lg:min-h-[64px] lg:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold tracking-tight lg:text-[26px]">{title}</h1>
          {subtitle ? (
            <p className="truncate text-[13px] text-ink-secondary">{subtitle}</p>
          ) : null}
        </div>
        {toolbar}
      </div>
    </header>
  );
}
