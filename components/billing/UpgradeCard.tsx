import Link from "next/link";
import { Lock } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/plans";

// Shown in place of a feature the member's plan doesn't include.
export default function UpgradeCard({ title, body, plan, className = "" }: { title: string; body: string; plan: PlanId; className?: string }) {
  return (
    <div className={`card max-w-xl p-6 ${className}`}>
      <p className="flex items-center gap-2 font-medium text-slate-100">
        <Lock className="h-4 w-4 text-amber-400" aria-hidden /> {title}
      </p>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
      <Link href={`/billing?plan=${plan}`} className="btn-primary mt-4 inline-flex px-4 py-2 text-sm">
        See {PLANS[plan].name} ({`$${PLANS[plan].monthlyUsd}/month`})
      </Link>
    </div>
  );
}
