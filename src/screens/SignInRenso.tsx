import { useState } from "react";
import { Moon, Sun, X } from "lucide-react";
import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { useTheme } from "@/lib/theme";

function LegalModal({
  kind,
  onClose,
}: {
  kind: "terms" | "privacy";
  onClose: () => void;
}) {
  const isTerms = kind === "terms";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-4">
      <div className="w-full max-w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[17px] font-semibold text-ink">
            {isTerms ? "Terms & Conditions" : "Privacy Policy"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-elevated"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-secondary">
          {isTerms ? (
            <>
              <p>Access to the Renso Group commercial platform is restricted to authorised personnel and approved third parties. Accounts are personal and must not be shared.</p>
              <p>Customer, supplier and pricing data held in the platform is confidential business information and must not be exported or disclosed outside Renso Group except for legitimate business purposes.</p>
              <p>The platform is provided "as is" during its prototype/demo phase; Renso Group accepts no liability for decisions made solely on demo data.</p>
              <p>Full terms are available under Settings → Legal once signed in.</p>
            </>
          ) : (
            <>
              <p>The platform holds business contact data, correspondence history, commercial records and, where provided, KYC/onboarding documents.</p>
              <p>In this prototype, data is held client-side for the session only and is not transmitted to a third-party server.</p>
              <p>Individuals may request access to, correction of, or deletion of their data, subject to legitimate business and record-keeping requirements.</p>
              <p>Full policy is available under Settings → Legal once signed in.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Theme switch for the sign-in screen.
 *
 * The lockup underneath it is two files — navy on light, white on dark — swapped
 * by the `data-theme` attribute, so flipping this also flips the logo. That is
 * the whole reason the toggle belongs here rather than only behind the gate:
 * it's the one screen where the full stacked lockup is shown at size, so it's
 * where a wrong-colour logo would be most obvious.
 */
function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="brand-focus flex h-10 items-center gap-2 rounded-full border border-divider bg-surface px-3.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

export function SignInPage() {
  const { signIn, continueAsGuest } = useStore();
  const [email, setEmail] = useState("roni@rensogroup.com");
  const [password, setPassword] = useState("roni");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [legalOpen, setLegalOpen] = useState<"terms" | "privacy" | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Email is required");
      return;
    }
    setLoading(true);
    setError("");
    const ok = signIn(email, password);
    setLoading(false);
    if (!ok) setError("Invalid credentials");
  };

  return (
    <div className="relative min-h-[100dvh] flex flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeSwitch />
      </div>

      <div className="w-full max-w-[420px]">
        <div className="flex justify-center mb-10 mt-6 sm:mt-2">
          <BrandLockup className="h-[120px]" />
        </div>

        <div className="brand-card p-8 sm:p-9">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Sign in
          </h1>
          <p className="text-[14px] text-ink-secondary mt-1 mb-7">
            Renso Group commercial platform
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[13px] font-medium text-ink-secondary">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="roni@rensogroup.com"
                autoComplete="email"
                className="h-12 rounded-xl border-divider bg-canvas text-[15px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[13px] font-medium text-ink-secondary">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-12 rounded-xl border-divider bg-canvas text-[15px]"
              />
            </div>
            {error ? <p className="text-sm text-accent">{error}</p> : null}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-full bg-accent hover:bg-accent/90 text-[15px] font-semibold shadow-sm mt-1"
            >
              {loading ? "Signing in…" : "Continue"}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-divider" />
            <span className="text-[11px] uppercase tracking-[0.18em] text-ink-tertiary">or</span>
            <span className="h-px flex-1 bg-divider" />
          </div>

          <button
            type="button"
            onClick={continueAsGuest}
            className="brand-focus brand-pressable mt-4 h-12 w-full rounded-full border border-divider bg-canvas text-[15px] font-semibold text-ink transition-colors hover:border-accent"
          >
            Continue without signing in
          </button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-tertiary">
            Opens the platform as a read-only guest session. Sign-in is a gate on
            a prototype, not a security boundary — this just saves you typing.
          </p>

          <div className="mt-6 rounded-xl bg-canvas border border-divider p-3.5">
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              <span className="font-semibold text-ink">Demo</span>
              <br />
              {email || "roni@rensogroup.com"} · password{" "}
              <span className="font-mono text-accent">roni</span>
            </p>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-tertiary tracking-wide">
          By continuing you agree to Renso Group's{" "}
          <button
            type="button"
            onClick={() => setLegalOpen("terms")}
            className="underline underline-offset-2 hover:text-accent"
          >
            Terms &amp; Conditions
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={() => setLegalOpen("privacy")}
            className="underline underline-offset-2 hover:text-accent"
          >
            Privacy Policy
          </button>
          .
        </p>

        <p className="mt-3 text-center text-[11px] text-ink-tertiary tracking-wide">
          Renso Group · 843 Finchley Rd, London NW11 8NA
        </p>
      </div>

      {legalOpen ? <LegalModal kind={legalOpen} onClose={() => setLegalOpen(null)} /> : null}
    </div>
  );
}
