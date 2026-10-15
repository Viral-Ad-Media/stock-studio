import { InputError, text, validDate } from "./journal";
import type { LeapsInput } from "./leaps";

export type ResearchContext = {
  studyId: number | null;
  watchlistId: number | null;
  thesis: string;
  contractSymbol: string;
};
export const EMPTY_CONTEXT: ResearchContext = {
  studyId: null,
  watchlistId: null,
  thesis: "",
  contractSymbol: "",
};
export function contextIds(
  raw: unknown,
): Pick<ResearchContext, "studyId" | "watchlistId"> {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  function id(value: unknown) {
    if (value == null || value === "") return null;
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "string" && !/^\d+$/.test(value))
    )
      throw new InputError("Invalid research link.");
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1)
      throw new InputError("Invalid research link.");
    return n;
  }
  return { studyId: id(r.studyId), watchlistId: id(r.watchlistId) };
}
// The caller must already have resolved an authenticated workspace. Both IDs
// and ticker are checked here so a handoff cannot attach another tenant's data.
export async function resolveResearch(
  query: (q: string, p: any[]) => Promise<any[]>,
  ws: string,
  ticker: string,
  raw: unknown,
): Promise<ResearchContext> {
  const ids = contextIds(raw);
  let thesis = "";
  if (ids.studyId) {
    const [study] = await query(
      "SELECT summary_line FROM stocks.case_studies WHERE workspace_id=$1 AND id=$2 AND ticker=$3 AND status='ready'",
      [ws, ids.studyId, ticker],
    );
    if (!study)
      throw new InputError(
        "Linked research is unavailable for this workspace and ticker.",
      );
    thesis = study.summary_line ?? "";
  }
  if (ids.watchlistId) {
    const [watch] = await query(
      "SELECT thesis,case_study_id FROM stocks.watchlist WHERE workspace_id=$1 AND id=$2 AND ticker=$3",
      [ws, ids.watchlistId, ticker],
    );
    if (
      !watch ||
      (ids.studyId &&
        watch.case_study_id &&
        Number(watch.case_study_id) !== ids.studyId)
    )
      throw new InputError(
        "Linked thesis is unavailable or does not match this study.",
      );
    thesis = watch.thesis || thesis;
  }
  const contractSymbol = text(
    (raw as any)?.contractSymbol,
    40,
    "Contract symbol",
  );
  if (contractSymbol && !/^[A-Z0-9. ]+$/.test(contractSymbol))
    throw new InputError("Invalid contract symbol.");
  return {
    ...ids,
    thesis: text(String(thesis), 4000, "Thesis"),
    contractSymbol,
  };
}
export function scenarioJournalHref(
  i: LeapsInput,
  c: ResearchContext,
  planId?: string,
) {
  const p = new URLSearchParams({
    ticker: i.ticker,
    asset: i.type,
    strike: String(i.strike),
    expiration: i.expiration,
    quantity: String(i.contracts),
  });
  if (c.studyId) p.set("study", String(c.studyId));
  if (c.watchlistId) p.set("watch", String(c.watchlistId));
  if (planId) p.set("plan", planId);
  return `/journal?${p}#journal-form`;
}
// A draft deliberately has no quote, model price, exit price or assumed fees.
export function contractDraft(
  raw: Record<string, string | undefined>,
): Record<string, string> {
  if (raw.asset !== "call" && raw.asset !== "put") return {};
  const strike = Number(raw.strike),
    quantity = Number(raw.quantity);
  if (
    !Number.isFinite(strike) ||
    strike <= 0 ||
    strike > 1e6 ||
    !validDate(raw.expiration) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 10000
  )
    throw new InputError(
      "The contract draft is invalid. Reopen it from the scenario.",
    );
  return {
    asset: raw.asset,
    side: "long",
    strike: String(strike),
    expiration: raw.expiration,
    quantity: String(quantity),
    entry_price: "",
    exit_price: "",
    closed_on: "",
  };
}
