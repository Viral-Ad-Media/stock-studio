"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import ResearchContextCard from "@/components/leaps/ResearchContextCard";
import { EMPTY_CONTEXT, type ResearchContext } from "@/lib/research-workflow";
import DecisionAnalysis from "./DecisionAnalysis";
import { useRouter } from "next/navigation";
import { journalStats, realizedPnl, type JournalTrade } from "@/lib/journal";
import JournalCharts from "@/components/charts/JournalCharts";
import PageHeader from "@/components/ui/PageHeader";
import { CSV_TEMPLATE } from "@/lib/journal-csv";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
const LABELS: Record<string, string> = {
  ticker: "Ticker",
  asset: "Asset",
  side: "Side",
  quantity: "Shares / contracts",
  entry_price: "Entry price per share ($)",
  opened_on: "Entry date",
  exit_price: "Exit price per share ($)",
  closed_on: "Exit date",
  strike: "Strike ($)",
  expiration: "Expiration",
  fees: "Total entry + exit fees ($)",
  initial_risk: "Initial risk for whole lot ($, optional)",
  strategy: "Strategy",
  thesis: "Entry thesis",
  review: "Exit review",
  case_study_id: "Linked research",
  source_ref: "Broker trade reference (optional)",
};
const BLANK = {
  ticker: "",
  asset: "stock",
  side: "long",
  quantity: "1",
  entry_price: "",
  opened_on: "",
  exit_price: "",
  closed_on: "",
  strike: "",
  expiration: "",
  fees: "0",
  initial_risk: "",
  strategy: "",
  thesis: "",
  review: "",
  case_study_id: "",
  source_ref: "",
};
type Form = typeof BLANK;
export default function JournalClient({
  rows,
  studies,
  today,
  archived,
  initialTicker,
  initialStudy,
  initialDraft = {},
  context = EMPTY_CONTEXT,
  draftError = "",
}: {
  rows: JournalTrade[];
  studies: { id: number; ticker: string; variant: string }[];
  today: string;
  archived: boolean;
  initialTicker: string;
  initialStudy: string;
  initialDraft?: Partial<Form>;
  context?: ResearchContext;
  draftError?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({
    ...BLANK,
    opened_on: today,
    ...initialDraft,
    ticker: /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(initialTicker)
      ? initialTicker.toUpperCase()
      : "",
    case_study_id:
      initialDraft.case_study_id ||
      (studies.some((s) => String(s.id) === initialStudy) ? initialStudy : ""),
    entry_price: "",
    exit_price: "",
    closed_on: "",
  });
  const [editing, setEditing] = useState<JournalTrade | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [filter, setFilter] = useState(""),
    [status, setStatus] = useState("all");
  const [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<JournalTrade[]>([]);
  const stats = useMemo(() => journalStats(rows), [rows]);
  const visible = rows.filter(
    (r) =>
      (!filter ||
        `${r.ticker} ${r.strategy}`
          .toLowerCase()
          .includes(filter.toLowerCase())) &&
      (status === "all" ||
        (status === "open" ? r.closed_on == null : r.closed_on != null)),
  );
  function change(key: keyof Form, value: string) {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "ticker" ? { case_study_id: "" } : {}),
      ...(key === "asset" ? { side: "long", strike: "", expiration: "" } : {}),
    }));
  }
  function reset() {
    setEditing(null);
    setForm({ ...BLANK, opened_on: today });
  }
  async function request(body: object, method = "POST") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/journal", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.errors?.join("\n") ||
            data.error ||
            "Couldn't save journal changes.",
        );
      }
      const data = await res.json();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const data = await request(
      editing
        ? { id: editing.id, version: editing.revision, trade: form }
        : form,
      editing ? "PATCH" : "POST",
    );
    if (data) {
      reset();
      setNotice("Trade saved.");
      router.refresh();
    }
  }
  function edit(row: JournalTrade) {
    setEditing(row);
    setForm(
      Object.fromEntries(
        Object.keys(BLANK).map((k) => [
          k,
          String(row[k as keyof JournalTrade] ?? ""),
        ]),
      ) as Form,
    );
    document
      .getElementById("journal-form")
      ?.scrollIntoView({ behavior: "smooth" });
  }
  async function archive(row: JournalTrade) {
    if (
      await request(
        { id: row.id, version: row.revision, archived: !archived },
        "PATCH",
      )
    ) {
      setNotice(
        archived
          ? "Trade restored."
          : "Trade archived. You can restore it from Archived.",
      );
      router.refresh();
    }
  }
  async function readFile(file: File | undefined) {
    setPreview([]);
    setCsv("");
    setError("");
    if (!file) return;
    if (file.size > 1000000) {
      setError("CSV must be under 1 MB.");
      return;
    }
    const content = await file.text();
    setCsv(content);
    const data = await request({ csv: content, preview: true });
    if (data) setPreview(data.preview);
  }
  function template() {
    const url = URL.createObjectURL(
      new Blob([CSV_TEMPLATE], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "journal-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  const numberFields = [
    "quantity",
    "entry_price",
    "exit_price",
    "strike",
    "fees",
    "initial_risk",
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your trading desk / Journal"
        title="Trading journal"
        description="Record a complete lot, its thesis and what happened. Stocks and purchased standard equity options only. For partial exits, split the entry into separate lots and allocate fees to each."
        actions={
          <>
            <Link
              href={archived ? "/journal" : "/journal?archived=1"}
              className="btn-secondary px-3 py-2 text-sm"
            >
              {archived ? "Active trades" : "Archived"}
            </Link>
            <a
              href={`/api/journal?format=csv${archived ? "&archived=1" : ""}`}
              className="btn-secondary px-3 py-2 text-sm"
            >
              Export CSV
            </a>
          </>
        }
      />
      {error && (
        <p
          role="alert"
          className="whitespace-pre-line rounded border border-red-500/40 p-3 text-sm text-red-400"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-400">
          {notice}
        </p>
      )}
      <section className="card p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-100">
          {archived ? "Archived-trade results" : "Your recorded results"}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Realized P&L after fees", money(stats.net)],
            ["Closed / open lots", `${stats.closed} / ${stats.open}`],
            [
              "Win rate",
              stats.winRate == null
                ? "No closed lots"
                : `${stats.winRate.toFixed(1)}% · n=${stats.closed}`,
            ],
            [
              "Profit factor",
              stats.profitFactor == null
                ? "Unavailable"
                : stats.profitFactor.toFixed(2),
            ],
          ].map(([label, value]) => (
            <div key={label} className="metric-tile">
              <p className="text-xs text-fg-subtle">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">
                {value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-subtle">
          {stats.wins} wins, {stats.losses} losses, {stats.breakeven} flat lots.
          Profit factor is shown only after 30 closed lots with at least one
          loss. Open positions have no modeled unrealized P&amp;L. All figures
          cover the {rows.length} entries in this view, before table filters.
        </p>
        <p className="mt-2 text-xs text-fg-subtle">
          Realized drawdown: {money(stats.drawdown)}, measured from cumulative
          daily closed-lot P&amp;L, not account equity.
          {stats.averageR != null &&
            ` Average R: ${stats.averageR.toFixed(2)} across ${stats.riskCount} lots with user-entered initial risk.`}
        </p>
        <JournalCharts stats={stats} />
        {stats.strategies.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="text-left text-xs text-fg-subtle">
                Realized results by strategy
              </caption>
              <thead>
                <tr className="text-left">
                  <th className="py-2">Strategy</th>
                  <th>Closed lots</th>
                  <th>Net P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {stats.strategies.map((s) => (
                  <tr key={s.name} className="border-t border-ink-700">
                    <td className="py-2">{s.name}</td>
                    <td>{s.count}</td>
                    <td>{money(s.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!archived && (
        <DecisionAnalysis
          rows={rows}
          studies={studies}
          today={today}
          onReview={edit}
        />
      )}
      {draftError && (
        <p role="alert" className="card p-4 text-sm text-amber-300">
          {draftError}
        </p>
      )}
      {!editing && form.ticker === initialTicker && (
        <ResearchContextCard context={context} />
      )}
      {!archived && (
        <section id="journal-form" className="card scroll-mt-6 p-5">
          <h2 className="mb-4 text-lg font-semibold">
            {editing ? "Edit / close this lot" : "Log a trade"}
          </h2>
          <p className="mb-4 text-sm text-fg-subtle">
            Contract details and research may be carried from a scenario. Enter
            your actual executed entry price, date, quantity and fees. Delayed
            quotes and model prices are never saved as fills automatically.
          </p>
          <form
            onSubmit={save}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {(Object.keys(BLANK) as (keyof Form)[])
              .filter(
                (k) =>
                  form.asset !== "stock" ||
                  !(k === "strike" || k === "expiration"),
              )
              .map((key) => (
                <label
                  key={key}
                  className={
                    key === "thesis" || key === "review"
                      ? "sm:col-span-2 lg:col-span-3"
                      : ""
                  }
                >
                  <span className="field-label">{LABELS[key]}</span>
                  {key === "asset" ? (
                    <select
                      className="input w-full"
                      value={form.asset}
                      onChange={(e) => change(key, e.target.value)}
                    >
                      <option value="stock">Stock</option>
                      <option value="call">Purchased call</option>
                      <option value="put">Purchased put</option>
                    </select>
                  ) : key === "side" ? (
                    <select
                      className="input w-full"
                      value={form.side}
                      onChange={(e) => change(key, e.target.value)}
                    >
                      <option value="long">Long</option>
                      {form.asset === "stock" && (
                        <option value="short">Short</option>
                      )}
                    </select>
                  ) : key === "case_study_id" ? (
                    <select
                      className="input w-full"
                      value={form[key]}
                      onChange={(e) => change(key, e.target.value)}
                    >
                      <option value="">No linked study</option>
                      {studies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.ticker} · {s.variant} · #{s.id}
                        </option>
                      ))}
                    </select>
                  ) : key === "thesis" || key === "review" ? (
                    <textarea
                      className="input min-h-24 w-full"
                      maxLength={4000}
                      value={form[key]}
                      onChange={(e) => change(key, e.target.value)}
                    />
                  ) : (
                    <input
                      className="input w-full"
                      type={
                        key.endsWith("_on") || key === "expiration"
                          ? "date"
                          : numberFields.includes(key)
                            ? "number"
                            : "text"
                      }
                      step={
                        key === "quantity" && form.asset !== "stock"
                          ? "1"
                          : "0.000001"
                      }
                      min={numberFields.includes(key) ? "0" : undefined}
                      max={numberFields.includes(key) ? "1000000" : undefined}
                      maxLength={
                        key === "ticker" ? 12 : key === "strategy" ? 100 : 200
                      }
                      required={[
                        "ticker",
                        "quantity",
                        "entry_price",
                        "opened_on",
                        "strike",
                        "expiration",
                      ].includes(key)}
                      value={form[key]}
                      onChange={(e) =>
                        change(
                          key,
                          key === "ticker"
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
              ))}
            <p className="sm:col-span-2 lg:col-span-3 text-xs text-fg-subtle">
              Option prices are quoted per share, multiplied by 100 per standard
              contract. Adjusted contracts, spreads and short options are not
              supported. Leave both exit fields blank for an open trade; a zero
              exit price is allowed for a closed worthless option. Fees are the
              total for this lot, including the exit.
            </p>
            <div className="flex gap-2">
              <button disabled={busy} className="btn-primary px-4 py-2 text-sm">
                {busy ? "Saving…" : "Save trade"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn-secondary px-4 py-2 text-sm"
                  onClick={reset}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </section>
      )}
      {!archived && (
        <section className="card p-5">
          <h2 className="font-semibold">Import trades</h2>
          <p className="mt-2 text-sm text-fg-subtle">
            Download the template and map your broker export to its columns.
            Dates use YYYY-MM-DD. Import one complete lot per row; a broker
            trade reference makes repeat imports idempotent.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={template}
              className="btn-secondary px-3 py-2 text-sm"
            >
              Download template
            </button>
            <label className="text-sm">
              Review CSV{" "}
              <input
                className="ml-2 max-w-full"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
            </label>
          </div>
          {preview.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">
                Preview: {preview.length} valid lots. Nothing has been imported
                yet.
              </p>
              <div className="mt-2 max-h-64 overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Asset</th>
                      <th>Quantity</th>
                      <th>Entry</th>
                      <th>Exit</th>
                      <th>Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} className="border-t border-ink-700">
                        <td className="py-2">{r.ticker}</td>
                        <td>{r.asset}</td>
                        <td>{r.quantity}</td>
                        <td>{r.entry_price}</td>
                        <td>{r.exit_price ?? "Open"}</td>
                        <td>
                          {realizedPnl(r) == null
                            ? "—"
                            : money(realizedPnl(r)!)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                disabled={busy}
                className="btn-primary mt-3 px-4 py-2 text-sm"
                onClick={async () => {
                  const data = await request({ csv, confirm: true });
                  if (data) {
                    setNotice(
                      `${data.inserted} imported; ${data.duplicates} repeat rows skipped.`,
                    );
                    setPreview([]);
                    setCsv("");
                    router.refresh();
                  }
                }}
              >
                Confirm import
              </button>
            </div>
          )}
        </section>
      )}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">
          {archived ? "Archived entries" : "Trade entries"}
        </h2>
        <div className="mb-3 flex flex-wrap gap-2">
          <label>
            <span className="sr-only">Filter ticker or strategy</span>
            <input
              className="input"
              placeholder="Ticker or strategy"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Trade status</span>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        {!visible.length ? (
          <p className="text-sm text-fg-subtle">No entries match this view.</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {visible.map((r) => (
              <li key={r.id} id={`trade-${r.id}`} className="scroll-mt-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono font-semibold text-slate-100">
                      {r.ticker} · {r.side} {r.asset}
                      {r.asset !== "stock" &&
                        ` · ${r.strike} · ${r.expiration}`}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {r.quantity}{" "}
                      {r.asset === "stock" ? "shares" : "contracts"} · entered{" "}
                      {r.opened_on} @ {r.entry_price}
                      {r.closed_on
                        ? ` · closed ${r.closed_on} @ ${r.exit_price}`
                        : " · Open"}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">
                    {realizedPnl(r) == null
                      ? "Unrealized not tracked"
                      : money(realizedPnl(r)!)}
                  </p>
                </div>
                {r.strategy && (
                  <p className="mt-2 text-xs text-emerald-400">{r.strategy}</p>
                )}
                {r.thesis && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    Thesis: {r.thesis}
                  </p>
                )}
                {r.review && (
                  <p className="mt-2 whitespace-pre-wrap text-sm">
                    Review: {r.review}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {r.case_study_id && (
                    <Link
                      href={`/study/${r.case_study_id}`}
                      className="text-emerald-400 underline"
                    >
                      Linked study
                    </Link>
                  )}
                  <Link
                    href={`/leaps?ticker=${encodeURIComponent(r.ticker)}`}
                    className="text-emerald-400 underline"
                  >
                    Explore options scenarios
                  </Link>
                  {!archived && (
                    <button
                      disabled={busy}
                      onClick={() => edit(r)}
                      className="underline"
                    >
                      Edit / close
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => void archive(r)}
                    className="underline"
                  >
                    {archived ? "Restore" : "Archive"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-fg-subtle">
        This is your editable, self-reported journal, not a verified broker
        statement or the program&apos;s immutable signal record. No orders are
        placed. No report credits are charged.
      </p>
    </div>
  );
}
