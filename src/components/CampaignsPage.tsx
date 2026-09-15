/**
 * Campaigns — mass mailing (requirement 7).
 *
 * The distinguishing piece is the audience builder: a campaign stores *rules*,
 * not a frozen list of addresses, and those rules resolve against live CRM data
 * both while you build and again at the moment of sending. Accounts change
 * between drafting and sending, and a list snapshotted a week earlier quietly
 * mails the wrong people.
 *
 * Every send is written into the recipient's own timeline, so the account page,
 * the mailbox and the campaign report all agree on what went out.
 */
import {
  ArrowLeft,
  BarChart3,
  Check,
  Copy,
  Eye,
  Megaphone,
  MousePointerClick,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { renderTemplate, useStore } from "@/lib/store";
import type { Campaign, CampaignAudience } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { SegmentedControl, inputClass } from "@/components/brand";
import type { AppSection } from "@/components/Shell";

function pct(part: number, whole: number) {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function shortDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<Campaign["status"], string> = {
  draft: "bg-elevated text-ink-secondary",
  scheduled: "bg-accent/10 text-accent",
  sending: "bg-accent/10 text-accent",
  sent: "bg-success/10 text-success",
  cancelled: "bg-elevated text-ink-tertiary",
};

export function CampaignsPage({
  onOpenRecord,
}: {
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const open = openId ? store.campaigns.find((c) => c.id === openId) : null;

  if (creating || open) {
    return (
      <CampaignEditor
        campaign={open ?? null}
        onBack={() => {
          setCreating(false);
          setOpenId(null);
        }}
        onNotice={setNotice}
        onOpenRecord={onOpenRecord}
      />
    );
  }

  const totals = store.campaigns.reduce(
    (acc, c) => ({
      sent: acc.sent + c.sentCount,
      opened: acc.opened + (c.openCount ?? 0),
      clicked: acc.clicked + (c.clickCount ?? 0),
    }),
    { sent: 0, opened: 0, clicked: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-semibold leading-none tracking-tight text-ink">
            Campaigns
          </h1>
          <p className="mt-2 text-[14px] text-ink-secondary">
            Segment the book, write once, and send to the right accounts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="brand-focus inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          New campaign
        </button>
      </div>

      {notice ? (
        <div className="brand-card flex items-start gap-3 p-3.5 text-[13px] text-ink-secondary">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-accent">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile icon={Send} label="Messages sent" value={totals.sent.toLocaleString("en-GB")} />
        <StatTile
          icon={Eye}
          label="Open rate"
          value={pct(totals.opened, totals.sent)}
          hint={`${totals.opened} opened`}
        />
        <StatTile
          icon={MousePointerClick}
          label="Click rate"
          value={pct(totals.clicked, totals.sent)}
          hint={`${totals.clicked} clicked`}
        />
      </div>

      <div className="brand-card divide-y divide-divider overflow-hidden">
        {store.campaigns.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenId(c.id)}
            className="flex w-full flex-col gap-2 px-4 py-4 text-left transition-colors hover:bg-elevated sm:flex-row sm:items-center"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent/10 text-accent">
              <Megaphone className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold text-ink">{c.name}</div>
              <div className="truncate text-[12.5px] text-ink-secondary">{c.subject}</div>
            </div>
            <div className="flex items-center gap-5 text-[12px] text-ink-tertiary sm:w-[260px]">
              <span className="tabular-nums">
                {c.sentCount || c.recipientCount} recipient
                {(c.sentCount || c.recipientCount) === 1 ? "" : "s"}
              </span>
              {c.status === "sent" ? (
                <>
                  <span className="tabular-nums">{pct(c.openCount ?? 0, c.sentCount)} open</span>
                  <span className="hidden tabular-nums lg:inline">{shortDate(c.sentAt)}</span>
                </>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize",
                STATUS_TONE[c.status],
              )}
            >
              {c.status}
            </span>
          </button>
        ))}
        {store.campaigns.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13px] text-ink-secondary">
            No campaigns yet. Create one to mail a segment of the book.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                     */
/* -------------------------------------------------------------------------- */

function CampaignEditor({
  campaign,
  onBack,
  onNotice,
  onOpenRecord,
}: {
  campaign: Campaign | null;
  onBack: () => void;
  onNotice: (m: string) => void;
  onOpenRecord: (section: AppSection, id?: string) => void;
}) {
  const store = useStore();
  const readOnly = campaign?.status === "sent";

  const [name, setName] = useState(campaign?.name ?? "");
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [preheader, setPreheader] = useState(campaign?.preheader ?? "");
  const [body, setBody] = useState(campaign?.templateBody ?? "");
  const [audience, setAudience] = useState<CampaignAudience>(
    campaign?.audience ?? { target: "customers", statuses: ["active"] },
  );
  const [tab, setTab] = useState<"audience" | "content" | "report">(
    campaign?.status === "sent" ? "report" : "audience",
  );

  const recipients = useMemo(() => store.resolveAudience(audience), [store, audience]);
  const withEmail = recipients.filter((r) => r.email);
  const missingEmail = recipients.length - withEmail.length;

  const save = (send: boolean) => {
    const payload = {
      name: name.trim() || "Untitled campaign",
      subject: subject.trim(),
      preheader: preheader.trim() || undefined,
      templateBody: body,
      audience,
      recipients: withEmail,
      recipientCount: withEmail.length,
    };
    const id = campaign ? (store.updateCampaign(campaign.id, payload), campaign.id) : store.addCampaign(payload);
    if (send) {
      const result = store.sendCampaign(id);
      onNotice(result.message);
    } else {
      onNotice("Campaign saved as a draft.");
    }
    onBack();
  };

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && withEmail.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="brand-focus inline-flex h-10 items-center gap-1.5 rounded-full border border-divider px-4 text-[13px] font-medium text-ink-secondary hover:bg-elevated hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          All campaigns
        </button>
        <span className="flex-1" />
        {campaign && !readOnly ? (
          <button
            type="button"
            onClick={() => {
              store.removeCampaign(campaign.id);
              onNotice("Campaign deleted.");
              onBack();
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-divider px-4 text-[13px] font-medium text-ink-secondary hover:bg-elevated hover:text-ink"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        ) : null}
        {!readOnly ? (
          <>
            <button
              type="button"
              onClick={() => save(false)}
              className="h-10 rounded-full border border-divider px-4 text-[13px] font-medium text-ink-secondary hover:bg-elevated hover:text-ink"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => save(true)}
              className={cn(
                "brand-focus inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13px] font-semibold",
                canSend ? "bg-accent text-white" : "cursor-not-allowed bg-elevated text-ink-tertiary",
              )}
            >
              <Send className="h-4 w-4" />
              Send to {withEmail.length}
            </button>
          </>
        ) : null}
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        readOnly={readOnly}
        placeholder="Campaign name"
        className="w-full bg-transparent text-[28px] font-semibold tracking-tight text-ink outline-none placeholder:text-ink-tertiary"
      />

      <div className="sm:w-[400px]">
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { id: "audience", label: "Audience" },
            { id: "content", label: "Content" },
            { id: "report", label: "Report" },
          ]}
        />
      </div>

      {tab === "audience" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="brand-card space-y-5 p-5">
            <div>
              <FieldLabel>Mail to</FieldLabel>
              <SegmentedControl
                value={audience.target}
                onChange={(v) =>
                  setAudience({ target: v as CampaignAudience["target"], statuses: [] })
                }
                options={[
                  { id: "customers", label: "Customers" },
                  { id: "contacts", label: "Contacts" },
                  { id: "suppliers", label: "Suppliers" },
                ]}
              />
            </div>

            <ChipGroup
              label="Account status"
              options={
                audience.target === "suppliers"
                  ? ["active", "preferred", "inactive"]
                  : ["lead", "active", "onboarding", "inactive"]
              }
              selected={audience.statuses ?? []}
              onToggle={(v) =>
                setAudience((a) => ({ ...a, statuses: toggle(a.statuses ?? [], v) }))
              }
              disabled={readOnly}
            />

            {audience.target === "customers" ? (
              <>
                <ChipGroup
                  label="Segment"
                  options={["wholesale", "retail", "distributor", "end_user", "other"]}
                  selected={(audience.segments as string[]) ?? []}
                  onToggle={(v) =>
                    setAudience((a) => ({
                      ...a,
                      segments: toggle((a.segments as string[]) ?? [], v) as CampaignAudience["segments"],
                    }))
                  }
                  disabled={readOnly}
                />
                <ChipGroup
                  label="Territory"
                  options={store.crmSettings.salesTerritories}
                  selected={audience.territories ?? []}
                  onToggle={(v) =>
                    setAudience((a) => ({ ...a, territories: toggle(a.territories ?? [], v) }))
                  }
                  disabled={readOnly}
                />

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!!audience.kycApprovedOnly}
                    disabled={readOnly}
                    onChange={(e) =>
                      setAudience((a) => ({ ...a, kycApprovedOnly: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                  <span className="text-[13px] text-ink">
                    Approved KYC only
                    <span className="block text-[12px] text-ink-tertiary">
                      Excludes accounts that haven't cleared onboarding.
                    </span>
                  </span>
                </label>

                <div>
                  <FieldLabel>Dormant for at least</FieldLabel>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      value={audience.minRecencyDays ?? 0}
                      disabled={readOnly}
                      onChange={(e) =>
                        setAudience((a) => ({ ...a, minRecencyDays: Number(e.target.value) || 0 }))
                      }
                      className={inputClass + " w-28"}
                    />
                    <span className="text-[13px] text-ink-secondary">
                      days since last order (0 = no rule)
                    </span>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="brand-card p-5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent" />
              <h3 className="text-[14px] font-semibold text-ink">Resolved audience</h3>
            </div>
            <div className="mt-3 text-[34px] font-semibold leading-none tabular-nums tracking-tight text-ink">
              {withEmail.length}
            </div>
            <p className="mt-1.5 text-[12px] text-ink-tertiary">
              matching {audience.target}
              {missingEmail > 0 ? ` · ${missingEmail} excluded, no email address` : ""}
            </p>

            <div className="thin-scroll mt-4 max-h-[280px] space-y-1 overflow-y-auto">
              {withEmail.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    onOpenRecord(
                      r.entityType === "supplier"
                        ? "suppliers"
                        : r.entityType === "contact"
                          ? "contacts"
                          : "customers",
                      r.entityId,
                    )
                  }
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-elevated"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{r.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-tertiary">{r.email}</span>
                  </span>
                </button>
              ))}
              {withEmail.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-secondary">
                  No accounts match these rules.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "content" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="brand-card space-y-4 p-5">
            <div>
              <FieldLabel>Subject</FieldLabel>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                readOnly={readOnly}
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Preview text</FieldLabel>
              <input
                value={preheader}
                onChange={(e) => setPreheader(e.target.value)}
                readOnly={readOnly}
                placeholder="The line shown after the subject in the inbox"
                className={inputClass}
              />
            </div>
            <div>
              <FieldLabel>Message</FieldLabel>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                readOnly={readOnly}
                rows={16}
                className="w-full resize-none rounded-control border border-divider bg-canvas px-3 py-2.5 text-[14px] leading-[1.65] text-ink outline-none focus:border-accent"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["{{first_name}}", "{{company}}", "{{sender_name}}"].map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setBody((b) => b + t)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 font-mono text-[11px] text-ink-secondary hover:text-ink"
                >
                  <Copy className="h-3 w-3" />
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview against a real recipient, so merge fields are checked
              against actual data rather than a placeholder. */}
          <div className="brand-card overflow-hidden">
            <div className="border-b border-divider px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
              Preview — as {withEmail[0]?.name ?? "a recipient"} receives it
            </div>
            <div className="px-5 py-4">
              <div className="text-[15px] font-semibold text-ink">{subject || "(no subject)"}</div>
              {preheader ? (
                <div className="mt-0.5 text-[12.5px] text-ink-tertiary">{preheader}</div>
              ) : null}
              <div className="mt-4 whitespace-pre-wrap text-[14px] leading-[1.65] text-ink">
                {renderTemplate(
                  body || "Your message will appear here.",
                  withEmail[0]?.name ?? "Recipient",
                  store.user?.name ?? "Renso Group",
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "report" ? (
        campaign?.status === "sent" ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatTile icon={Send} label="Delivered" value={String(campaign.sentCount)} />
              <StatTile
                icon={Eye}
                label="Opened"
                value={pct(campaign.openCount ?? 0, campaign.sentCount)}
                hint={`${campaign.openCount ?? 0} of ${campaign.sentCount}`}
              />
              <StatTile
                icon={MousePointerClick}
                label="Clicked"
                value={pct(campaign.clickCount ?? 0, campaign.sentCount)}
                hint={`${campaign.clickCount ?? 0} of ${campaign.sentCount}`}
              />
              <StatTile
                icon={BarChart3}
                label="Bounced"
                value={String(campaign.bounceCount ?? 0)}
                hint={`Sent ${shortDate(campaign.sentAt)}`}
              />
            </div>

            <div className="brand-card divide-y divide-divider overflow-hidden">
              <div className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                Recipients
              </div>
              {campaign.recipients.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] text-ink">{r.name}</div>
                    <div className="truncate text-[12px] text-ink-tertiary">{r.email}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[11px] text-ink-tertiary">
                    {r.delivered ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="h-3.5 w-3.5" />
                        Delivered
                      </span>
                    ) : null}
                    {r.opened ? <span className="text-accent">Opened</span> : null}
                  </div>
                </div>
              ))}
              {campaign.recipients.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-ink-secondary">
                  No recipient detail recorded for this campaign.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="brand-card p-10 text-center">
            <BarChart3 className="mx-auto mb-3 h-9 w-9 text-ink-tertiary" strokeWidth={1.25} />
            <p className="text-[14px] text-ink-secondary">
              Engagement appears here once the campaign has been sent.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
      {children}
    </div>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  disabled?: boolean;
}) {
  if (!options.length) return null;
  return (
    <div>
      <FieldLabel>
        {label}
        {selected.length === 0 ? (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-tertiary">
            — any
          </span>
        ) : null}
      </FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(o)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors",
                active ? "bg-accent text-white" : "bg-elevated text-ink-secondary hover:text-ink",
              )}
            >
              {o.replace(/_/g, " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Send;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="brand-card p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent/10 text-accent">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[12px] text-ink-secondary">{label}</span>
      </div>
      <div className="mt-2 text-[24px] font-semibold leading-none tabular-nums tracking-tight text-ink">
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11.5px] text-ink-tertiary">{hint}</div> : null}
    </div>
  );
}
