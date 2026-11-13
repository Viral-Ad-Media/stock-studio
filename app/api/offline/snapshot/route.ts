import { NextResponse } from "next/server";
import { sql, type CaseStudy } from "@/lib/db";
import { currentUser, currentWorkspaceId } from "@/lib/workspace";
import { getMembership } from "@/lib/membership";
import { renderMarkdown, safeHttpUrl } from "@/lib/markdown";
import { parseStoredGrade } from "@/lib/grades";
import { JournalStore } from "@/lib/journal-store";
import { canReadSignals, SIGNAL_FEED_SQL, signalFeedParams } from "@/lib/signal-feed";

export const dynamic = "force-dynamic";

// Compact, workspace-scoped snapshot cached in IndexedDB so members can read
// their case studies, watchlist theses, trading journal, saved LEAPS scenarios,
// and permitted trade signals completely offline (even before clicking into
// individual study pages). Markdown is sanitized here with lib/markdown.ts.
export async function GET() {
  const user = await currentUser();
  const ws = await currentWorkspaceId();
  if (!user || !ws) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const membership = await getMembership(user.id, ws);
    const journalStore = new JournalStore((q, p) => sql.unsafe(q, p));

    const [studiesRaw, watchlistRaw, journalRows, leapsRows, signalRows] = await Promise.all([
      sql`
        SELECT id, ticker, company, variant, status, as_of_date, summary_line,
               grade_json, content_md, corrections_md, sources_json, created_at, updated_at
        FROM case_studies
        WHERE workspace_id = ${ws}
        ORDER BY id DESC
        LIMIT 25
      ` as unknown as Promise<CaseStudy[]>,
      sql`
        SELECT id, ticker, company, status_tag, thesis, thesis_status,
               thesis_status_note, triggers_json, snapshot, as_of_date, updated_at
        FROM watchlist
        WHERE workspace_id = ${ws}
        ORDER BY updated_at DESC
        LIMIT 100
      `,
      journalStore.list(ws, false).then((rows) => rows.slice(0, 200)).catch(() => []),
      membership.ent.leaps
        ? sql`
            SELECT id, name, ticker, inputs, updated_at
            FROM leaps_plans
            WHERE workspace_id = ${ws} AND archived_at IS NULL
            ORDER BY updated_at DESC
            LIMIT 50
          `.catch(() => [])
        : Promise.resolve([]),
      canReadSignals(membership.ent.signals)
        ? sql
            .unsafe(
              SIGNAL_FEED_SQL,
              signalFeedParams(membership.ent.signals, membership.ent.signalDelayDays, 30),
            )
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const studies = studiesRaw.map((s) => {
      const grade = s.status === "ready" ? parseStoredGrade(s.grade_json) : null;
      const sources = Array.isArray(s.sources_json)
        ? s.sources_json
            .map((src) => {
              const safe = safeHttpUrl(src?.url);
              return safe ? { title: String(src?.title || safe), url: safe } : null;
            })
            .filter((x): x is { title: string; url: string } => x !== null)
        : [];

      return {
        id: s.id,
        ticker: s.ticker,
        company: s.company,
        variant: s.variant,
        status: s.status,
        asOfDate: s.as_of_date,
        summaryLine: s.summary_line ?? null,
        gradeLetter: grade?.overall ?? null,
        renderedHtml: s.content_md ? renderMarkdown(s.content_md) : null,
        correctionsHtml: s.corrections_md ? renderMarkdown(s.corrections_md) : null,
        sources,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      };
    });

    const watchlist = watchlistRaw.map((w) => ({
      id: Number(w.id),
      ticker: String(w.ticker),
      company: w.company ? String(w.company) : null,
      statusTag: String(w.status_tag ?? "watching"),
      thesis: w.thesis ? String(w.thesis) : null,
      thesisStatus: String(w.thesis_status ?? "unknown"),
      thesisStatusNote: w.thesis_status_note ? String(w.thesis_status_note) : null,
      triggers: Array.isArray(w.triggers_json) ? w.triggers_json.map(String) : [],
      snapshot: w.snapshot ? String(w.snapshot) : null,
      asOfDate: w.as_of_date ? String(w.as_of_date) : null,
      updatedAt: w.updated_at,
    }));

    return NextResponse.json(
      {
        userId: user.id,
        workspaceId: ws,
        syncedAt: new Date().toISOString(),
        studies,
        watchlist,
        journal: journalRows,
        leapsPlans: leapsRows.map((p) => ({
          id: String(p.id),
          name: String(p.name),
          ticker: String(p.ticker),
          inputs: p.inputs,
          updatedAt: p.updated_at,
        })),
        signals: signalRows.map((sig) => ({
          id: Number(sig.id),
          postedAt: sig.posted_at,
          action: String(sig.action),
          ticker: String(sig.ticker),
          instrument: sig.instrument ? String(sig.instrument) : null,
          entry: sig.entry ? String(sig.entry) : null,
          target: sig.target ? String(sig.target) : null,
          stop: sig.stop ? String(sig.stop) : null,
          detail: String(sig.detail ?? ""),
          pick: Boolean(sig.pick),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    console.error("offline snapshot failed", err);
    return NextResponse.json(
      { error: "Unable to build offline snapshot right now." },
      { status: 503 },
    );
  }
}
