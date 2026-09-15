import type { ReactNode } from "react";

/**
 * Small dependency-free compatibility wrapper. The current CRM does not use
 * tooltip primitives directly, but keeping the provider boundary makes the
 * shell easy to enhance without coupling the app to a platform runtime.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}