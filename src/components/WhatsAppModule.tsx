/**
 * WhatsApp — a chat client, not a mailbox with the word "WhatsApp" on it.
 *
 * The previous version pointed the mail module at `channel === "whatsapp"`, so
 * WhatsApp inherited folders, a subject column and a reading pane. That is the
 * wrong shape for the medium: nobody on the other end of these messages thinks
 * in folders, and Roni's suppliers send five-word messages that a reading pane
 * renders as mostly whitespace.
 *
 * So this is built on the chat primitives instead — conversations grouped by
 * counterparty, bubbles in date order, ticks, a composer — while keeping the
 * one thing a normal WhatsApp client can't do: every conversation is bound to
 * the account and the commercial record it concerns, and terms quoted in a
 * message can be pushed into the pricing review queue without leaving the pane.
 *
 * The underlying record is still `Communication`, unchanged. Mail and chat are
 * two presentations of one timeline, which is why a WhatsApp message about
 * QT-2026-0042 still shows up on the quotation's correspondence.
 */
import {
  ArrowLeft,
  Building2,
  CheckCheck,
  ChevronDown,
  Clock,
  FileText,
  Flag,
  Info,
  MessageCircle,
  Package,
  Paperclip,
  Plus,
  Receipt,
  Search,
  Send,
  Smile,
  Sparkles,
  Star,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { Communication } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { AppSection } from "@/components/Shell";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function initialsOf(value: string) {
  const cleaned = (value || "").replace(/[<>"]/g, "").trim();
  if (!cleaned) return "?";
  // A bare phone number has no initials worth showing — use the last two
  // digits, which is what the human eye actually uses to tell two unsaved
  // numbers apart.
  if (/^[+\d][\d\s()-]+$/.test(cleaned)) {
    const digits = cleaned.replace(/\D/g, "");
    return digits.slice(-2) || "#";
  }
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Stable per-conversation avatar tint, so the same contact is always the same
 *  colour without storing anything. */
const AVATAR_TINTS = [
  "bg-[#6B7CB8]",
  "bg-[#3F7D6E]",
  "bg-[#A4685A]",
  "bg-[#6E6AA8]",
  "bg-[#4F7EA8]",
  "bg-[#8A6BA8]",
  "bg-[#5E8A62]",
  "bg-[#A8865E]",
];

function tintFor(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

function startOfDay(iso: string) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** WhatsApp's chat-list clock: time today, "Yesterday", weekday this week,
 *  date beyond that. */
function listStamp(iso: string) {
  const d = new Date(iso);
  const today = startOfDay(new Date().toISOString());
  const day = startOfDay(iso);
  if (day === today) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (today - day === 86400000) return "Yesterday";
  if (today - day < 7 * 86400000) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function bubbleStamp(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function dayChipLabel(iso: string) {
  const today = startOfDay(new Date().toISOString());
  const day = startOfDay(iso);
  if (day === today) return "Today";
  if (today - day === 86400000) return "Yesterday";
  if (today - day < 7 * 86400000) {
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "long" });
  }
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function money(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Delivery state for an outbound message.
 *
 * Deliberately honest about what we know. A real WhatsApp Business API webhook
 * reports sent / delivered / read as three separate events; this prototype only
 * holds a read flag, so "delivered" is the floor for anything that has left
 * drafts. It is marked as inferred in the info panel rather than dressed up as
 * a real receipt.
 */
type TickState = "pending" | "delivered" | "read";

function tickStateFor(m: Communication): TickState {
  if ((m.folder ?? "sent") === "drafts") return "pending";
  return m.isRead ? "read" : "delivered";
}

function Ticks({ state }: { state: TickState }) {
  if (state === "pending") return <Clock className="h-3.5 w-3.5 opacity-70" />;
  if (state === "read") return <CheckCheck className="wa-tick-read h-3.5 w-3.5" />;
  return <CheckCheck className="h-3.5 w-3.5 opacity-70" />;
}

/* -------------------------------------------------------------------------- */
/* Conversation model                                                         */
/* -------------------------------------------------------------------------- */

interface Chat {
  /** Account id where we know it, otherwise the raw number. */
  key: string;
  name: string;
  /** Counterparty number, as best we know it. */
  phone: string;
  subtitle: string;
  customerId?: string;
  supplierId?: string;
  messages: Communication[];
  last: Communication;
  unread: number;
  starred: boolean;
  flagged: boolean;
}

/**
 * Groups the WhatsApp timeline into conversations.
 *
 * Keyed on the account wherever the message is matched to one, so two numbers
 * belonging to the same supplier collapse into a single thread rather than
 * splitting the history — which is the behaviour anyone chasing a price needs.
 * Unmatched numbers fall back to the number itself.
 */
function buildChats(
  messages: Communication[],
  nameFor: (m: Communication) => { name: string; subtitle: string; phone: string },
): Chat[] {
  const groups = new Map<string, Communication[]>();
  for (const m of messages) {
    const counterparty = m.isReceived ? m.from : m.to;
    const key = m.customerId || m.supplierId || counterparty || m.id;
    const bucket = groups.get(key);
    if (bucket) bucket.push(m);
    else groups.set(key, [m]);
  }

  const chats: Chat[] = [];
  for (const [key, bucket] of groups) {
    const ordered = [...bucket].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    const last = ordered[ordered.length - 1];
    const identity = nameFor(last);
    chats.push({
      key,
      name: identity.name,
      phone: identity.phone,
      subtitle: identity.subtitle,
      customerId: ordered.find((m) => m.customerId)?.customerId,
      supplierId: ordered.find((m) => m.supplierId)?.supplierId,
      messages: ordered,
      last,
      unread: ordered.filter((m) => m.isReceived && !m.isRead).length,
      starred: ordered.some((m) => m.isStarred),
      flagged: ordered.some((m) => m.isFlagged),
    });
  }

  return chats.sort(
    (a, b) => new Date(b.last.occurredAt).getTime() - new Date(a.last.occurredAt).getTime(),
  );
}

/* -------------------------------------------------------------------------- */
/* Module                                                                     */
/* -------------------------------------------------------------------------- */

export function WhatsAppModule({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "flagged">("all");
  const [infoOpen, setInfoOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(t);
  }, [notice]);

  const chatMessages = useMemo(
    () => store.communications.filter((c) => c.channel === "whatsapp"),
    [store.communications],
  );

  /** Resolves the display identity for a conversation from the account it's
   *  matched to, falling back to whatever the message itself carries. */
  const nameFor = useMemo(
    () =>
      (m: Communication) => {
        const customer = store.customers.find((c) => c.id === m.customerId);
        const supplier = store.suppliers.find((s) => s.id === m.supplierId);
        const account = customer || supplier;
        const phone = (m.isReceived ? m.from : m.to) || "";
        const person = m.isReceived ? m.fromName : undefined;
        if (account) {
          return {
            name: person ? `${person} · ${account.name}` : account.name,
            subtitle: customer ? "Customer" : "Supplier",
            phone,
          };
        }
        return { name: person || phone || "Unknown", subtitle: "Not linked to an account", phone };
      },
    [store.customers, store.suppliers],
  );

  const chats = useMemo(() => buildChats(chatMessages, nameFor), [chatMessages, nameFor]);

  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((chat) => {
      if (filter === "unread" && chat.unread === 0) return false;
      if (filter === "flagged" && !chat.flagged) return false;
      if (!q) return true;
      return (
        chat.name.toLowerCase().includes(q) ||
        chat.phone.toLowerCase().includes(q) ||
        chat.messages.some((m) => m.body.toLowerCase().includes(q))
      );
    });
  }, [chats, query, filter]);

  const activeChat = useMemo(
    () => chats.find((c) => c.key === activeKey) ?? null,
    [chats, activeKey],
  );

  /* Opening a chat marks its received messages read, exactly as the real client
     does — leaving them unread after you've plainly read them is how a count
     stops meaning anything. */
  useEffect(() => {
    if (!activeChat) return;
    for (const m of activeChat.messages) {
      if (m.isReceived && !m.isRead) store.markCommunicationRead(m.id, true);
    }
    // Re-runs on key change only: the messages array identity changes on every
    // store write, which would otherwise loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat?.key]);

  const totalUnread = chats.reduce((sum, c) => sum + c.unread, 0);

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[520px] overflow-hidden rounded-card border border-divider">
      {/* ---------------------------------------------------------------- */}
      {/* Chat list                                                        */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className={cn(
          "wa-panel flex w-full shrink-0 flex-col border-r md:w-[340px] lg:w-[380px]",
          "wa-divider",
          activeChat ? "hidden md:flex" : "flex",
        )}
      >
        <header className="wa-header flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="wa-accent-bg flex h-9 w-9 items-center justify-center rounded-full text-white">
              <MessageCircle className="h-[18px] w-[18px]" />
            </span>
            <div>
              <div className="text-[15px] font-semibold text-ink">WhatsApp</div>
              <div className="wa-meta text-[11px]">
                {store.organisation.phone || "+44 7700 900418"} · Business
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            aria-label="New chat"
            className="wa-accent-ink brand-focus flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/10"
          >
            <Plus className="h-5 w-5" />
          </button>
        </header>

        <div className="wa-panel px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-[rgb(var(--wa-chat-bg))] px-3 py-2">
            <Search className="wa-meta h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or start a new chat"
              className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-[rgb(var(--wa-meta))]"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="wa-meta h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex gap-1.5">
            {([
              { id: "all", label: "All" },
              { id: "unread", label: totalUnread ? `Unread ${totalUnread}` : "Unread" },
              { id: "flagged", label: "Follow up" },
            ] as const).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                  filter === f.id
                    ? "wa-accent-bg text-white"
                    : "bg-[rgb(var(--wa-chat-bg))] text-[rgb(var(--wa-meta))]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="thin-scroll flex-1 overflow-y-auto">
          {visibleChats.length === 0 ? (
            <p className="wa-meta px-5 py-10 text-center text-[13px]">
              {query || filter !== "all"
                ? "No conversations match."
                : "No WhatsApp conversations yet."}
            </p>
          ) : (
            visibleChats.map((chat) => (
              <ChatRow
                key={chat.key}
                chat={chat}
                active={chat.key === activeKey}
                onSelect={() => {
                  setActiveKey(chat.key);
                  setInfoOpen(false);
                }}
              />
            ))
          )}
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Conversation                                                     */}
      {/* ---------------------------------------------------------------- */}
      {activeChat ? (
        <Conversation
          chat={activeChat}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          onBack={() => setActiveKey(null)}
          onOpenRecord={onOpenRecord}
          onNotice={setNotice}
        />
      ) : (
        <div className="wa-chat-bg hidden flex-1 flex-col items-center justify-center px-8 text-center md:flex">
          <span className="wa-accent-bg mb-5 flex h-16 w-16 items-center justify-center rounded-full text-white">
            <MessageCircle className="h-7 w-7" />
          </span>
          <h2 className="text-[19px] font-semibold text-ink">Renso Group on WhatsApp</h2>
          <p className="wa-meta mt-2 max-w-sm text-[13.5px] leading-relaxed">
            Pick a conversation to read it. Every chat is bound to the customer or
            supplier it belongs to, so a price quoted here can be banked against
            the right account without being retyped.
          </p>
        </div>
      )}

      {newChatOpen ? (
        <NewChatSheet
          onClose={() => setNewChatOpen(false)}
          onStarted={(key, message) => {
            setActiveKey(key);
            setNewChatOpen(false);
            setNotice(message);
          }}
        />
      ) : null}

      {notice ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-canvas shadow-overlay">
            {notice}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chat list row                                                              */
/* -------------------------------------------------------------------------- */

function ChatRow({
  chat,
  active,
  onSelect,
}: {
  chat: Chat;
  active: boolean;
  onSelect: () => void;
}) {
  const last = chat.last;
  const preview = last.body.replace(/\s+/g, " ").trim();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-b px-3.5 py-2.5 text-left transition-colors wa-divider",
        active ? "bg-[rgb(var(--wa-chat-bg))]" : "hover:bg-[rgb(var(--wa-chat-bg))]",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white",
          tintFor(chat.key),
        )}
      >
        {initialsOf(chat.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[15px] font-medium text-ink">{chat.name}</span>
          <span
            className={cn(
              "shrink-0 text-[11.5px]",
              chat.unread ? "wa-accent-ink font-semibold" : "wa-meta",
            )}
          >
            {listStamp(last.occurredAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {!last.isReceived ? (
            <span className="shrink-0">
              <Ticks state={tickStateFor(last)} />
            </span>
          ) : null}
          <span className="wa-meta min-w-0 flex-1 truncate text-[13px]">{preview}</span>
          {chat.flagged ? <Flag className="wa-accent-ink h-3 w-3 shrink-0" /> : null}
          {chat.unread ? (
            <span className="wa-accent-bg flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white">
              {chat.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Conversation pane                                                          */
/* -------------------------------------------------------------------------- */

/** Business quick replies. Real WhatsApp Business has saved replies; these are
 *  the four things a trading desk actually types twenty times a week. */
const QUICK_REPLIES = [
  "Thanks — checking with the mill now, I'll come back today.",
  "Can you confirm the price is ex-works and how long it holds?",
  "Noted. Sending the revised quotation across shortly.",
  "Payment has gone out today — remittance to follow.",
];

function Conversation({
  chat,
  infoOpen,
  onToggleInfo,
  onBack,
  onOpenRecord,
  onNotice,
}: {
  chat: Chat;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onBack: () => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
  onNotice: (text: string) => void;
}) {
  const store = useStore();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<Communication | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  /* Jump to the newest message on open and after sending — a chat that opens
     at the top of a two-year history is useless. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.key, chat.messages.length]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    const context = chat.messages[chat.messages.length - 1];
    store.sendCommunication({
      channel: "whatsapp",
      to: chat.phone,
      subject: chat.name,
      body: replyTo ? `> ${replyTo.body.slice(0, 120)}\n${body}` : body,
      customerId: chat.customerId,
      supplierId: chat.supplierId,
      quotationId: context?.quotationId,
      orderId: context?.orderId,
      invoiceId: context?.invoiceId,
      threadId: context?.threadId,
    });
    setDraft("");
    setReplyTo(null);
  };

  /* Group consecutive messages from the same side so only the first in a run
     gets a tail, and insert a date chip whenever the day changes. */
  const rendered = useMemo(() => {
    const out: {
      message: Communication;
      showTail: boolean;
      dayChip: string | null;
    }[] = [];
    let previous: Communication | null = null;
    for (const message of chat.messages) {
      const dayChanged =
        !previous || startOfDay(previous.occurredAt) !== startOfDay(message.occurredAt);
      const sideChanged = !previous || previous.isReceived !== message.isReceived;
      out.push({
        message,
        showTail: dayChanged || sideChanged,
        dayChip: dayChanged ? dayChipLabel(message.occurredAt) : null,
      });
      previous = message;
    }
    return out;
  }, [chat.messages]);

  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="wa-header flex items-center gap-3 border-b px-3 py-2.5 wa-divider">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chats"
            className="brand-focus -ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary hover:bg-black/10 md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onToggleInfo}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white",
                tintFor(chat.key),
              )}
            >
              {initialsOf(chat.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-ink">{chat.name}</span>
              <span className="wa-meta block truncate text-[12px]">
                {chat.phone || chat.subtitle}
              </span>
            </span>
          </button>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                store.toggleCommunicationFlag(chat.last.id);
                onNotice(
                  chat.flagged ? "Follow-up cleared." : "Flagged for follow up.",
                );
              }}
              aria-label="Flag for follow up"
              className={cn(
                "brand-focus flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/10",
                chat.flagged ? "wa-accent-ink" : "text-ink-secondary",
              )}
            >
              <Flag className="h-[18px] w-[18px]" />
            </button>
            <button
              type="button"
              onClick={onToggleInfo}
              aria-label="Conversation info"
              className={cn(
                "brand-focus flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/10",
                infoOpen ? "wa-accent-ink" : "text-ink-secondary",
              )}
            >
              <Info className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="wa-chat-bg thin-scroll flex-1 overflow-y-auto px-3 py-4 sm:px-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-1">
            <div className="mx-auto mb-3 max-w-md rounded-lg bg-[rgb(var(--wa-bubble-in))] px-3 py-2 text-center text-[11.5px] leading-relaxed text-[rgb(var(--wa-meta))]">
              Messages are held in the CRM against this account. Attachments and
              quoted prices can be filed straight from a message.
            </div>

            {rendered.map(({ message, showTail, dayChip }) => (
              <div key={message.id}>
                {dayChip ? (
                  <div className="my-3 flex justify-center">
                    <span className="wa-day-chip">{dayChip}</span>
                  </div>
                ) : null}
                <Bubble
                  message={message}
                  showTail={showTail}
                  onReply={() => setReplyTo(message)}
                  onStar={() => store.toggleCommunicationStar(message.id)}
                  onExtract={() => {
                    const id = store.extractFromCommunication(message.id);
                    onNotice(
                      id
                        ? "Terms banked in the pricing review queue — nothing approved yet."
                        : "No unit price found in that message, so nothing was banked.",
                    );
                  }}
                  onFile={(attachmentId, name) => {
                    const id = store.fileAttachment(message.id, attachmentId);
                    onNotice(id ? `“${name}” filed in Documents.` : "Already filed.");
                  }}
                />
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Composer */}
        <footer className="wa-header border-t px-3 py-2.5 wa-divider">
          {replyTo ? (
            <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-lg bg-[rgb(var(--wa-bubble-in))] px-3 py-2">
              <div className="wa-quote min-w-0 flex-1">
                <div className="wa-accent-ink text-[12px] font-semibold">
                  {replyTo.isReceived ? replyTo.fromName || replyTo.from : "You"}
                </div>
                <div className="wa-meta truncate text-[12.5px]">{replyTo.body}</div>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X className="wa-meta h-4 w-4" />
              </button>
            </div>
          ) : null}

          {quickOpen ? (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
              {QUICK_REPLIES.map((reply) => (
                <button
                  key={reply}
                  type="button"
                  onClick={() => {
                    setDraft(reply);
                    setQuickOpen(false);
                  }}
                  className="rounded-full border px-3 py-1.5 text-left text-[12px] text-ink-secondary hover:text-ink wa-divider"
                >
                  {reply.length > 46 ? `${reply.slice(0, 46)}…` : reply}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              aria-label="Saved replies"
              className="brand-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-black/10"
            >
              <Smile className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onNotice(
                  "Attachments arrive from the WhatsApp Business API — outbound upload isn't wired yet.",
                )
              }
              aria-label="Attach"
              className="brand-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-black/10"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter breaks the line — the convention
                // everyone already has in their fingers.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Type a message"
              className="thin-scroll max-h-32 min-h-[40px] flex-1 resize-none rounded-[20px] bg-[rgb(var(--wa-panel))] px-4 py-2.5 text-[14.5px] leading-[1.35] text-ink outline-none placeholder:text-[rgb(var(--wa-meta))]"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim()}
              aria-label="Send"
              className={cn(
                "brand-focus flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity",
                draft.trim() ? "wa-accent-bg" : "wa-accent-bg opacity-40",
              )}
            >
              <Send className="h-[18px] w-[18px]" />
            </button>
          </div>
        </footer>
      </div>

      {infoOpen ? (
        <InfoPanel chat={chat} onClose={onToggleInfo} onOpenRecord={onOpenRecord} />
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Bubble                                                                     */
/* -------------------------------------------------------------------------- */

function Bubble({
  message,
  showTail,
  onReply,
  onStar,
  onExtract,
  onFile,
}: {
  message: Communication;
  showTail: boolean;
  onReply: () => void;
  onStar: () => void;
  onExtract: () => void;
  onFile: (attachmentId: string, name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const outbound = !message.isReceived;

  /* A message body that starts with "> " is a quoted reply written by the
     composer above; render it as WhatsApp renders a reply rather than leaving
     the marker showing. */
  const quoted = message.body.startsWith("> ")
    ? message.body.slice(2).split("\n")[0]
    : null;
  const body = quoted ? message.body.split("\n").slice(1).join("\n") : message.body;

  return (
    <div className={cn("group flex items-end gap-1", outbound ? "justify-end" : "justify-start")}>
      {outbound ? <BubbleMenu open={menuOpen} setOpen={setMenuOpen} align="left" items={[
        { label: "Reply", onClick: onReply },
        { label: message.isStarred ? "Unstar" : "Star", onClick: onStar },
      ]} /> : null}

      <div
        className={cn(
          "wa-bubble",
          outbound ? "wa-bubble-out" : "wa-bubble-in",
          !showTail && "wa-bubble-tailless",
        )}
      >
        {quoted ? (
          <div className="wa-quote mb-1.5">
            <div className="wa-accent-ink text-[12px] font-semibold">
              {outbound ? "Replying to" : message.fromName || message.from}
            </div>
            <div className="truncate text-[12.5px] opacity-70">{quoted}</div>
          </div>
        ) : null}

        <p className="whitespace-pre-wrap text-[14.5px] leading-[1.35]">{body}</p>

        {message.attachments?.length ? (
          <div className="mt-2 space-y-1.5">
            {message.attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-md bg-black/10 px-2 py-1.5"
              >
                <FileText className="h-4 w-4 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{a.name}</span>
                <button
                  type="button"
                  onClick={() => onFile(a.id, a.name)}
                  className="shrink-0 text-[11.5px] font-semibold underline underline-offset-2 opacity-80"
                >
                  {a.documentId ? "Filed" : "File"}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] opacity-65">
          {message.isStarred ? <Star className="h-3 w-3 fill-current" /> : null}
          <span>{bubbleStamp(message.occurredAt)}</span>
          {outbound ? <Ticks state={tickStateFor(message)} /> : null}
        </div>

        {/* Extraction is offered on received messages only — we already hold the
            terms we sent, so re-banking them would just duplicate our own
            quote back into the review queue. */}
        {message.isReceived && !message.extracted ? (
          <button
            type="button"
            onClick={onExtract}
            className="wa-accent-ink mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-semibold"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Extract terms
          </button>
        ) : null}
        {message.extracted ? (
          <div className="mt-1.5 text-[11px] opacity-60">Terms already banked</div>
        ) : null}
      </div>

      {!outbound ? <BubbleMenu open={menuOpen} setOpen={setMenuOpen} align="right" items={[
        { label: "Reply", onClick: onReply },
        { label: message.isStarred ? "Unstar" : "Star", onClick: onStar },
      ]} /> : null}
    </div>
  );
}

function BubbleMenu({
  open,
  setOpen,
  items,
  align,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  items: { label: string; onClick: () => void }[];
  align: "left" | "right";
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Message actions"
        className="wa-meta flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className={cn(
            "wa-panel absolute bottom-8 z-20 w-36 overflow-hidden rounded-lg border shadow-panel wa-divider",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-[13px] text-ink hover:bg-[rgb(var(--wa-chat-bg))]"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Info panel — the CRM half                                                  */
/* -------------------------------------------------------------------------- */

function InfoPanel({
  chat,
  onClose,
  onOpenRecord,
}: {
  chat: Chat;
  onClose: () => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const customer = store.customers.find((c) => c.id === chat.customerId);
  const supplier = store.suppliers.find((s) => s.id === chat.supplierId);

  /* Records mentioned anywhere in the conversation, not just on the last
     message — a chat that starts about a quotation and ends about the invoice
     should surface both. */
  const linked = useMemo(() => {
    const quotationIds = new Set<string>();
    const orderIds = new Set<string>();
    const invoiceIds = new Set<string>();
    const productIds = new Set<string>();
    for (const m of chat.messages) {
      if (m.quotationId) quotationIds.add(m.quotationId);
      if (m.orderId) orderIds.add(m.orderId);
      if (m.invoiceId) invoiceIds.add(m.invoiceId);
      if (m.productId) productIds.add(m.productId);
    }
    return {
      quotations: store.quotations.filter((q) => quotationIds.has(q.id)),
      orders: store.orders.filter((o) => orderIds.has(o.id)),
      invoices: store.invoices.filter((i) => invoiceIds.has(i.id)),
      products: store.products.filter((p) => productIds.has(p.id)),
    };
  }, [chat.messages, store.quotations, store.orders, store.invoices, store.products]);

  const attachments = chat.messages.flatMap((m) => m.attachments ?? []);
  const nothingLinked =
    !customer &&
    !supplier &&
    !linked.quotations.length &&
    !linked.orders.length &&
    !linked.invoices.length &&
    !linked.products.length;

  return (
    <aside className="wa-panel thin-scroll hidden w-[300px] shrink-0 overflow-y-auto border-l lg:block wa-divider">
      <header className="wa-header flex items-center justify-between px-4 py-3">
        <span className="text-[14px] font-semibold text-ink">Conversation info</span>
        <button type="button" onClick={onClose} aria-label="Close info">
          <X className="wa-meta h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col items-center px-4 py-5 text-center">
        <span
          className={cn(
            "flex h-20 w-20 items-center justify-center rounded-full text-[26px] font-semibold text-white",
            tintFor(chat.key),
          )}
        >
          {initialsOf(chat.name)}
        </span>
        <div className="mt-3 text-[16px] font-semibold text-ink">{chat.name}</div>
        <div className="wa-meta text-[12.5px]">{chat.phone}</div>
        <div className="wa-meta mt-1 text-[12px]">
          {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"} · {chat.subtitle}
        </div>
      </div>

      <div className="px-4 pb-5">
        <div className="wa-meta mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
          Linked records
        </div>
        <div className="space-y-2">
          {customer ? (
            <LinkedRecord
              icon={Building2}
              label="Customer"
              title={customer.name}
              detail={`${customer.status} · ${money(customer.totalRevenue ?? 0, customer.currency)} lifetime`}
              onClick={() => onOpenRecord("customers", customer.id)}
            />
          ) : null}
          {supplier ? (
            <LinkedRecord
              icon={Truck}
              label="Supplier"
              title={supplier.name}
              detail={`${supplier.status} · ${money(supplier.totalSpend ?? 0, supplier.currency)} spend`}
              onClick={() => onOpenRecord("suppliers", supplier.id)}
            />
          ) : null}
          {linked.quotations.map((q) => (
            <LinkedRecord
              key={q.id}
              icon={FileText}
              label="Quotation"
              title={q.number}
              detail={`${q.status} · ${money(q.total, q.currency)}`}
              onClick={() => onOpenRecord("quotations", q.id)}
            />
          ))}
          {linked.orders.map((o) => (
            <LinkedRecord
              key={o.id}
              icon={Package}
              label="Order"
              title={o.number}
              detail={`${o.status} · ${money(o.total, o.currency)}`}
              onClick={() => onOpenRecord("orders", o.id)}
            />
          ))}
          {linked.invoices.map((i) => (
            <LinkedRecord
              key={i.id}
              icon={Receipt}
              label="Invoice"
              title={i.number}
              detail={`${i.status} · ${money(i.total, i.currency)}`}
              onClick={() => onOpenRecord("invoices", i.id)}
            />
          ))}
          {linked.products.map((p) => (
            <LinkedRecord
              key={p.id}
              icon={Package}
              label="Product"
              title={p.name}
              detail={p.sku}
              onClick={() => onOpenRecord("products", p.id)}
            />
          ))}
          {nothingLinked ? (
            <p className="wa-meta text-[12.5px] leading-relaxed">
              This number isn't matched to an account yet. Add it to a contact and
              the history will attach itself to their timeline.
            </p>
          ) : null}
        </div>
      </div>

      {attachments.length ? (
        <div className="border-t px-4 py-4 wa-divider">
          <div className="wa-meta mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
            Files ({attachments.length})
          </div>
          <div className="space-y-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <FileText className="wa-meta h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{a.name}</span>
                {a.documentId ? (
                  <button
                    type="button"
                    onClick={() => onOpenRecord("documents", a.documentId)}
                    className="wa-accent-ink shrink-0 text-[11.5px] font-semibold"
                  >
                    Open
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t px-4 py-4 wa-divider">
        <div className="wa-meta text-[11.5px] leading-relaxed">
          Read receipts are inferred from whether the message has been opened in
          this CRM. Real sent / delivered / read events need a WhatsApp Business
          API webhook, which isn't connected.
        </div>
      </div>
    </aside>
  );
}

function LinkedRecord({
  icon: Icon,
  label,
  title,
  detail,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title: string;
  detail?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors hover:bg-[rgb(var(--wa-chat-bg))] wa-divider"
    >
      <span className="wa-accent-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="wa-meta block text-[10.5px] uppercase tracking-[0.08em]">{label}</span>
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        {detail ? <span className="wa-meta block truncate text-[11.5px]">{detail}</span> : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* New chat                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Starting a new chat picks a real account rather than asking for a number,
 * because an unmatched number is exactly the thing that makes a CRM's message
 * history useless six months later.
 */
function NewChatSheet({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (key: string, message: string) => void;
}) {
  const store = useStore();
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: {
      key: string;
      name: string;
      side: "Customer" | "Supplier";
      phone: string;
      customerId?: string;
      supplierId?: string;
    }[] = [];
    for (const c of store.customers) {
      rows.push({
        key: c.id,
        name: c.name,
        side: "Customer",
        phone: c.phone || "",
        customerId: c.id,
      });
    }
    for (const s of store.suppliers) {
      rows.push({
        key: s.id,
        name: s.name,
        side: "Supplier",
        phone: s.phone || "",
        supplierId: s.id,
      });
    }
    return rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [store.customers, store.suppliers, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="wa-panel flex max-h-[80vh] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border shadow-overlay wa-divider">
        <header className="wa-header flex items-center justify-between px-4 py-3">
          <span className="text-[15px] font-semibold text-ink">New chat</span>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="wa-meta h-4 w-4" />
          </button>
        </header>
        <div className="px-4 py-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customers and suppliers"
            className="w-full rounded-lg bg-[rgb(var(--wa-chat-bg))] px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-[rgb(var(--wa-meta))]"
          />
        </div>
        <div className="thin-scroll flex-1 overflow-y-auto pb-3">
          {options.length === 0 ? (
            <p className="wa-meta px-4 py-6 text-center text-[13px]">No accounts match.</p>
          ) : (
            options.map((o) => (
              <button
                key={`${o.side}-${o.key}`}
                type="button"
                onClick={() => {
                  if (!o.phone) {
                    onStarted(
                      o.key,
                      `${o.name} has no phone number on file — add one on the account first.`,
                    );
                    return;
                  }
                  store.sendCommunication({
                    channel: "whatsapp",
                    to: o.phone,
                    subject: o.name,
                    body: `Hi — Roni here at Renso Group.`,
                    customerId: o.customerId,
                    supplierId: o.supplierId,
                  });
                  onStarted(o.key, `Chat started with ${o.name}.`);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--wa-chat-bg))]"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white",
                    tintFor(o.key),
                  )}
                >
                  {initialsOf(o.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{o.name}</span>
                  <span className="wa-meta block truncate text-[12px]">
                    {o.side} · {o.phone || "no number on file"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
