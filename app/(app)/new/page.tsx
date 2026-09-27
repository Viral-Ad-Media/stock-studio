import { sql } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspace";
import { parseTicker, isInvalid } from "@/lib/validate";
import { VARIANTS, HIDDEN_FORM_VARIANTS } from "@/lib/shared";
import NewStudyForm, { ExistingStudy } from "@/components/NewStudyForm";

// /new?ticker=AAPL&company=Apple%20Inc.&variant=memo pre-fills the form, so a
// study page can offer "another format for this company" in one click.
export default async function NewStudyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const parsed = parseTicker(one(sp.ticker));
  const ticker = isInvalid(parsed) ? "" : parsed;
  const company = ticker ? one(sp.company).trim().slice(0, 200) : "";
  const formats = VARIANTS.filter((v) => !HIDDEN_FORM_VARIANTS.includes(v.value)).map((v) => v.value);
  const requested = one(sp.variant);
  const variant = formats.includes(requested) ? requested : "full";

  const existing: Record<string, ExistingStudy> = {};
  const ws = ticker ? await currentWorkspaceId() : null;
  if (ws) {
    const rows = await sql`
      SELECT DISTINCT ON (variant) id, variant, status FROM case_studies
      WHERE workspace_id = ${ws} AND ticker = ${ticker} AND status IN ('ready', 'queued', 'building')
      ORDER BY variant, (status = 'ready') DESC, id DESC
    `;
    for (const r of rows) existing[r.variant as string] = { id: Number(r.id), status: r.status as string };
  }

  return <NewStudyForm initialTicker={ticker} initialCompany={company} initialVariant={variant} existing={existing} />;
}
