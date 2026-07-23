/**
 * Engine CLI — how Claude Code reads and writes the jobs queue.
 *
 *   npm run engine -- pending                 list pending jobs with their context (JSON)
 *   npm run engine -- claim <jobId>           mark a job running, print its full context (JSON)
 *   npm run engine -- complete <jobId> [--content <file.md>] [--meta <file.json>]
 *   npm run engine -- fail <jobId> --message "<why>"
 *
 * `complete` semantics by job type:
 *   build_case_study / earnings_update / movers_digest — --content is required (the finished markdown).
 *     --meta may set: company, as_of_date, sources ([{title,url}]), corrections_md.
 *   watchlist_entry — --meta is required with: thesis, snapshot, triggers ([string]),
 *     as_of_date; optional: company, status_tag, case_study_id.
 *
 * Requires DATABASE_URL (hosted Postgres, `stocks` schema) — read from
 * .env.local automatically.
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env.local") });

import { sql } from "../lib/db";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function out(obj: unknown) {
  console.log(JSON.stringify(obj, null, 2));
}

async function jobContext(job: any) {
  const payload = job.payload as Record<string, any>;
  const ctx: any = { job };
  if (payload.case_study_id) {
    const [study] = await sql`SELECT * FROM case_studies WHERE id = ${payload.case_study_id}`;
    ctx.case_study = study;
    if (study?.parent_id) {
      const [parent] = await sql`
        SELECT id, ticker, variant, as_of_date, content_md FROM case_studies WHERE id = ${study.parent_id}
      `;
      ctx.parent_study = parent;
    }
  }
  if (payload.watchlist_id) {
    const [w] = await sql`SELECT * FROM watchlist WHERE id = ${payload.watchlist_id}`;
    ctx.watchlist = w;
  }
  return ctx;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "pending") {
    const jobs = await sql`SELECT * FROM jobs WHERE status IN ('pending','running') ORDER BY id`;
    out(await Promise.all(jobs.map(jobContext)));
  } else if (cmd === "claim") {
    const id = Number(process.argv[3]);
    const [job] = await sql`SELECT * FROM jobs WHERE id = ${id}`;
    if (!job) {
      console.error(`No job ${id}`);
      process.exit(1);
    }
    await sql`UPDATE jobs SET status = 'running', updated_at = now() WHERE id = ${id}`;
    const payload = job.payload as Record<string, any>;
    if (payload.case_study_id) {
      await sql`UPDATE case_studies SET status = 'building', updated_at = now() WHERE id = ${payload.case_study_id}`;
    }
    out(await jobContext({ ...job, status: "running" }));
  } else if (cmd === "complete") {
    const id = Number(process.argv[3]);
    const [job] = await sql`SELECT * FROM jobs WHERE id = ${id}`;
    if (!job) {
      console.error(`No job ${id}`);
      process.exit(1);
    }
    const payload = job.payload as Record<string, any>;
    const contentPath = arg("--content");
    const metaPath = arg("--meta");
    const content = contentPath ? fs.readFileSync(contentPath, "utf8") : null;
    const meta = metaPath ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};

    if (job.type === "build_case_study" || job.type === "earnings_update" || job.type === "movers_digest") {
      if (!content) {
        console.error("--content <file.md> is required for case study jobs");
        process.exit(1);
      }
      await sql`
        UPDATE case_studies SET
          status = 'ready', content_md = ${content}, error = NULL,
          company = COALESCE(${meta.company ?? null}, company),
          as_of_date = COALESCE(${meta.as_of_date ?? null}, as_of_date),
          sources_json = COALESCE(${meta.sources ? sql.json(meta.sources) : null}, sources_json),
          corrections_md = COALESCE(${meta.corrections_md ?? null}, corrections_md),
          updated_at = now()
        WHERE id = ${payload.case_study_id}
      `;
    } else if (job.type === "watchlist_entry") {
      if (!meta.thesis) {
        console.error("--meta with at least {thesis} is required for watchlist jobs");
        process.exit(1);
      }
      await sql`
        UPDATE watchlist SET
          thesis = ${meta.thesis},
          snapshot = COALESCE(${meta.snapshot ?? null}, snapshot),
          triggers_json = COALESCE(${meta.triggers ? sql.json(meta.triggers) : null}, triggers_json),
          as_of_date = COALESCE(${meta.as_of_date ?? null}, as_of_date),
          company = COALESCE(${meta.company ?? null}, company),
          status_tag = COALESCE(${meta.status_tag ?? null}, status_tag),
          case_study_id = COALESCE(${meta.case_study_id ?? null}, case_study_id),
          updated_at = now()
        WHERE id = ${payload.watchlist_id}
      `;
    }

    await sql`UPDATE jobs SET status = 'done', result = ${meta.result ?? "ok"}, updated_at = now() WHERE id = ${id}`;
    out({ ok: true, job_id: id });
  } else if (cmd === "fail") {
    const id = Number(process.argv[3]);
    const message = arg("--message") ?? "unknown error";
    const [job] = await sql`SELECT * FROM jobs WHERE id = ${id}`;
    if (!job) {
      console.error(`No job ${id}`);
      process.exit(1);
    }
    const payload = job.payload as Record<string, any>;
    await sql`UPDATE jobs SET status = 'error', result = ${message}, updated_at = now() WHERE id = ${id}`;
    if (payload.case_study_id) {
      await sql`UPDATE case_studies SET status = 'error', error = ${message}, updated_at = now() WHERE id = ${payload.case_study_id}`;
    }
    out({ ok: true, job_id: id, failed: true });
  } else {
    console.error("Usage: npm run engine -- <pending|claim|complete|fail> [args]");
    process.exit(1);
  }

  await sql.end();
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
