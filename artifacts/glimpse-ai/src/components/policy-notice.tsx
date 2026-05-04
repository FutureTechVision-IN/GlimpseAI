import React from "react";
import { AlertTriangle, LifeBuoy } from "lucide-react";
import { SUPPORT_EMAIL } from "@/lib/support";

/**
 * Combined "no refund" + "cancel via support" notice. Rendered prominently
 * on every commerce page (billing, pricing) so users always see the policy
 * BEFORE they purchase, satisfying the operational requirement that we
 * communicate these terms transparently and consistently.
 */
export function PolicyNotice(): React.ReactElement {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" aria-hidden />
        <div className="text-xs text-amber-100/90 space-y-1.5">
          <p>
            <span className="font-semibold text-amber-50">No-refund policy.</span> Once a service is used or a one-time
            credit pack has been redeemed, the purchase is non-refundable. Voluntary contributions are non-refundable.
          </p>
          <p>
            <LifeBuoy className="w-3 h-3 inline-block mr-1 -mt-0.5 text-amber-300" />
            <span className="font-semibold text-amber-50">Cancellations &amp; account closure:</span> handled exclusively
            by support. Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber-300 underline hover:text-amber-200">
              {SUPPORT_EMAIL}
            </a>{" "}
            for any cancellation, account-closure, or billing-dispute request.
          </p>
        </div>
      </div>
    </div>
  );
}
