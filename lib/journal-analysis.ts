import { realizedPnl, validDate, type JournalTrade } from "./journal";
const day = 86_400_000;
export function decisionAnalysis(rows: JournalTrade[]) {
  const closed = rows.filter((t) => !t.archived_at && realizedPnl(t) != null);
  const net = closed.reduce((sum, t) => sum + realizedPnl(t)!, 0);
  const holding = [
    { name: "0–30 days", min: 0, max: 30 },
    { name: "31–90 days", min: 31, max: 90 },
    { name: "91–365 days", min: 91, max: 365 },
    { name: "366+ days", min: 366, max: Infinity },
  ].map((b) => {
    const trades = closed.filter((t) => {
      const d = (Date.parse(t.closed_on!) - Date.parse(t.opened_on)) / day;
      return d >= b.min && d <= b.max;
    });
    const pnl = trades.reduce((n, t) => n + realizedPnl(t)!, 0);
    return {
      name: b.name,
      count: trades.length,
      pnl,
      expectancy: trades.length ? pnl / trades.length : null,
    };
  });
  const theses = new Map<
    number | null,
    { id: number | null; count: number; pnl: number; reviewed: number }
  >();
  const calendar = new Map<
    string,
    { date: string; count: number; pnl: number }
  >();
  for (const t of closed) {
    const group = theses.get(t.case_study_id) ?? {
      id: t.case_study_id,
      count: 0,
      pnl: 0,
      reviewed: 0,
    };
    group.count++;
    group.pnl += realizedPnl(t)!;
    if (t.review.trim()) group.reviewed++;
    theses.set(t.case_study_id, group);
    const entry = calendar.get(t.closed_on!) ?? {
      date: t.closed_on!,
      count: 0,
      pnl: 0,
    };
    entry.count++;
    entry.pnl += realizedPnl(t)!;
    calendar.set(t.closed_on!, entry);
  }
  const losses = closed.filter((t) => realizedPnl(t)! < 0),
    wins = closed.filter((t) => realizedPnl(t)! > 0);
  return {
    count: closed.length,
    expectancy: closed.length ? net / closed.length : null,
    averageWin: wins.length
      ? wins.reduce((n, t) => n + realizedPnl(t)!, 0) / wins.length
      : null,
    averageLoss: losses.length
      ? losses.reduce((n, t) => n + realizedPnl(t)!, 0) / losses.length
      : null,
    holding,
    theses: [...theses.values()],
    calendar: [...calendar.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    reviewed: closed.filter((t) => t.review.trim()).length,
  };
}
export function calendarDays(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) return [];
  const first = Date.parse(`${month}-01T00:00:00Z`),
    start = new Date(first).getUTCDay(),
    days = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
    ).getUTCDate();
  return Array.from({ length: start + days }, (_, i) =>
    i < start ? null : `${month}-${String(i - start + 1).padStart(2, "0")}`,
  );
}
