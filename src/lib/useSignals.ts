/**
 * One place that turns the live store into signals.
 *
 * The top-bar indicator, the dashboard strip and the Signals page all read
 * from this hook, so they cannot disagree about how many things need doing —
 * which is exactly what happens when three surfaces each count for themselves.
 */
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { buildSignals, type Signal } from "@/lib/signals";

export function useLiveSignals(): Signal[] {
  const store = useStore();
  return useMemo(
    () =>
      buildSignals({
        customers: store.customers,
        suppliers: store.suppliers,
        products: store.products,
        invoices: store.invoices,
        orders: store.orders,
        quotations: store.quotations,
        deliveries: store.deliveries,
        payments: store.payments,
        pricingRecords: store.pricingRecords,
        kycRecords: store.kycRecords,
        documents: store.documents,
        communications: store.communications,
        contacts: store.contacts,
        ownDomains: ["rensogroup.com"],
        fx: store.fx,
        reportingCurrency: store.fx.base,
        marginFloorPct: store.productSettings.lowMarginThresholdPct,
        documentExpiryWarningDays: store.crmSettings.documentExpiryWarningDays,
        followUpReminderDays: store.crmSettings.followUpReminderDays,
      }).filter((signal) => !store.dismissedSignals.includes(signal.id)),
    [store],
  );
}
