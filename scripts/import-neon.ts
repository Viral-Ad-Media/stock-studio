/** Run against an EMPTY isolated Neon branch, never an existing application DB.
 * Inputs are private catalog/data exports from one source snapshot. Credentials
 * are environment-only; output contains counts and validation outcomes only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const roles = ["stocks_app", "stocks_billing", "stocks_admin", "stocks_signals", "stocks_auth", "anon", "authenticated", "service_role"];
const allowed = new Set([...roles, "PUBLIC"]);
async function main() {
const source = JSON.parse(await readFile(process.argv[2], "utf8"));
const schema = JSON.parse(await readFile(process.argv[3], "utf8"));
if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL is required");
const url = new URL(process.env.NEON_DATABASE_URL);
if (!url.hostname.endsWith(".neon.tech") || url.hostname.includes("-pooler")) throw new Error("Use a direct Neon migration connection");
const emitFile = process.argv[4];
const statements: string[] = [];
const literal = (v: any): string => v == null ? "NULL" : typeof v === "boolean" || typeof v === "number" ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
const emit: any = Object.assign(async (strings: TemplateStringsArray, ...values: any[]) => {
  statements.push(strings.reduce((s,part,i) => s + part + (i < values.length ? literal(values[i]) : ""), "") + ";");
  return [{ stocks: null, auth: null }];
}, {
  unsafe: async (sql: string, params: any[] = []) => {
    statements.push((params.length ? sql.replace(/\$(\d+)\b/g, (_,n) => literal(params[Number(n)-1])) : sql) + ";");
    return [{ equal: true }];
  },
  begin: async (fn: any) => fn(emit), json: JSON.stringify, end: async () => {},
});
const db: ReturnType<typeof postgres> = emitFile ? emit : postgres(url.toString(), { ssl: "require", max: 1, prepare: false });
if (emitFile) statements.push("BEGIN; DO $$ BEGIN IF to_regnamespace('stocks') IS NOT NULL OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'Target schemas already exist'; END IF; END $$;");
try {
  const [existing] = await db`SELECT to_regnamespace('stocks') AS stocks, to_regnamespace('auth') AS auth`;
  if (existing.stocks || existing.auth) throw new Error("Refusing to import over an existing schema");
  for (const role of roles) {
    await db.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${q(role)} NOLOGIN NOINHERIT; END IF; END $$`);
  }
  await db.begin(async tx => {
    await tx.unsafe(await readFile("db/identity.sql", "utf8"));
    await tx.unsafe("CREATE SCHEMA stocks; SET LOCAL check_function_bodies = false;");
    // Serial sequences need to exist before column DEFAULT expressions.
    const serial = new Set<string>();
    for (const t of schema.tables) for (const c of t.columns) {
      if (!c.identity && c.default) {
        const match = c.default.match(/nextval\('stocks\.([^']+)'::regclass\)/);
        if (match) serial.add(match[1]);
      }
    }
    for (const s of schema.sequences || []) if (serial.has(s.name)) {
      await tx.unsafe(`CREATE SEQUENCE stocks.${q(s.name)} AS ${s.type} INCREMENT ${s.increment} MINVALUE ${s.min} MAXVALUE ${s.type === "bigint" && s.max >= 9223372036854775807 ? "9223372036854775807" : s.max} START ${s.start} CACHE ${s.cache} ${s.cycle ? "CYCLE" : "NO CYCLE"}`);
    }
    for (const t of schema.tables) {
      const cols = t.columns.map((c: any) => `${q(c.name)} ${c.type}${c.identity ? ` GENERATED ${c.identity === "a" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY` : c.generated ? ` GENERATED ALWAYS AS (${c.default}) STORED` : c.default ? ` DEFAULT ${c.default}` : ""}${c.notNull ? " NOT NULL" : ""}`);
      await tx.unsafe(`CREATE TABLE stocks.${q(t.name)} (${cols.join(",")})`);
    }
    const users = source.find((x: any) => x.name === "identity_users").rows;
    for (const u of users) {
      const md = u.raw_user_meta_data || {};
      const name = md.full_name || md.name || [md.first_name,md.last_name].filter(Boolean).join(" ") || u.email;
      await tx`INSERT INTO auth.users(id,email,name,email_verified,image,created_at,updated_at,raw_user_meta_data,raw_app_meta_data,last_sign_in_at)
        VALUES(${u.id},${u.email},${name},${!!u.email_confirmed_at},${md.avatar_url || null},${u.created_at},${u.updated_at || u.created_at},${tx.json(md)},${tx.json(u.raw_app_meta_data || {})},${u.last_sign_in_at})`;
    }
    // Import before attaching triggers: no welcome credits, signals, webhooks,
    // or provisioning side effects are replayed for historical rows.
    for (const t of schema.tables) {
      const rows = source.find((x: any) => x.name === t.name)?.rows;
      if (!rows) throw new Error(`Missing source table ${t.name}`);
      if (rows.length) {
        const cols = t.columns.filter((c: any) => !c.generated).map((c: any) => q(c.name)).join(",");
        await tx.unsafe(`INSERT INTO stocks.${q(t.name)} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM jsonb_populate_recordset(NULL::stocks.${q(t.name)},$1::jsonb)`,[JSON.stringify(rows)]);
      }
    }
    for (const c of schema.constraints.filter((c: any) => c.type !== "f")) await tx.unsafe(`ALTER TABLE ${c.table} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
    for (const c of schema.constraints.filter((c: any) => c.type === "f")) await tx.unsafe(`ALTER TABLE ${c.table} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
    for (const f of schema.functions) {
      // Supabase's pg_net/Vault webhook is replaced by the host scheduler.
      const definition = f.name === "notify_job_inserted" ? `CREATE FUNCTION stocks.notify_job_inserted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$` : f.definition;
      await tx.unsafe(definition);
      await tx.unsafe(`REVOKE ALL ON FUNCTION ${f.identity} FROM PUBLIC`);
      for (const a of f.acl || []) if (allowed.has(a.role)) await tx.unsafe(`GRANT ${a.privilege} ON FUNCTION ${f.identity} TO ${a.role === "PUBLIC" ? "PUBLIC" : q(a.role)}`);
    }
    for (const v of schema.views || []) await tx.unsafe(`CREATE VIEW stocks.${q(v.name)} AS ${v.definition}`);
    for (const index of schema.indexes || []) await tx.unsafe(index);
    for (const t of schema.tables) {
      if (t.rls) await tx.unsafe(`ALTER TABLE stocks.${q(t.name)} ENABLE ROW LEVEL SECURITY`);
      for (const a of t.acl || []) if (allowed.has(a.role)) await tx.unsafe(`GRANT ${a.privilege} ON stocks.${q(t.name)} TO ${a.role === "PUBLIC" ? "PUBLIC" : q(a.role)}`);
    }
    for (const p of schema.policies || []) {
      await tx.unsafe(`CREATE POLICY ${q(p.name)} ON stocks.${q(p.table)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map((r: string) => r === "public" ? "PUBLIC" : q(r)).join(",")}${p.using ? ` USING (${p.using})` : ""}${p.check ? ` WITH CHECK (${p.check})` : ""}`);
    }
    for (const trigger of schema.triggers || []) await tx.unsafe(trigger);
    for (const role of roles.filter(r => r.startsWith("stocks_"))) await tx.unsafe(`GRANT USAGE ON SCHEMA stocks TO ${q(role)}; ALTER ROLE ${q(role)} SET search_path=stocks,public;`);
    // Source server roles used BYPASSRLS. Neon roles stay NOBYPASSRLS with
    // explicit server policies, while original table/function ACLs still apply.
    for (const t of schema.tables) for (const role of ["stocks_app","stocks_signals"]) {
      await tx.unsafe(`CREATE POLICY ${q("server_"+role)} ON stocks.${q(t.name)} TO ${q(role)} USING(true) WITH CHECK(true)`);
    }
    await tx.unsafe("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA stocks TO stocks_app,stocks_admin,stocks_billing,stocks_signals");
    for (const t of schema.tables) for (const c of t.columns) if (c.identity || c.default?.includes("nextval(")) {
      await tx.unsafe(`SELECT setval(pg_get_serial_sequence('stocks.${q(t.name)}', '${c.name}'), GREATEST(COALESCE((SELECT max(${q(c.name)}) FROM stocks.${q(t.name)}),1),1), EXISTS(SELECT 1 FROM stocks.${q(t.name)}))`);
    }
    // Exact typed-row comparison, rather than count-only validation.
    for (const t of schema.tables) {
      const rows = source.find((x: any) => x.name === t.name).rows;
      const [result] = await tx.unsafe(`SELECT NOT EXISTS((SELECT * FROM stocks.${q(t.name)} EXCEPT SELECT * FROM jsonb_populate_recordset(NULL::stocks.${q(t.name)},$1::jsonb)) UNION ALL (SELECT * FROM jsonb_populate_recordset(NULL::stocks.${q(t.name)},$1::jsonb) EXCEPT SELECT * FROM stocks.${q(t.name)})) AS equal`,[JSON.stringify(rows)]);
      if (!result.equal) throw new Error(`Data mismatch: ${t.name}`);
    }
  });
  await db.unsafe(await readFile("db/better-auth.sql", "utf8"));
  const users = source.find((x: any) => x.name === "identity_users").rows;
  for (const u of users) if (u.encrypted_password) {
    if (!/^\$2[aby]\$/.test(u.encrypted_password)) throw new Error("Unsupported legacy password format");
    await db`INSERT INTO auth.accounts(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(${randomUUID()},${u.id},'credential',${u.id},${u.encrypted_password},${u.created_at},${u.updated_at || u.created_at})`;
  }
  // New accounts retain the same transactional provisioning/invite rules.
  await db.unsafe(`CREATE TRIGGER stocks_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION stocks.handle_new_user();
    GRANT USAGE ON SCHEMA auth TO stocks_auth,stocks_app,stocks_signals;
    GRANT EXECUTE ON FUNCTION auth.uid() TO stocks_app,stocks_signals;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO stocks_auth;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO stocks_auth;
    GRANT EXECUTE ON FUNCTION stocks.ops_alert_sweep(interval) TO stocks_app;
    REVOKE ALL ON SCHEMA auth FROM PUBLIC;
    ALTER ROLE stocks_auth SET search_path=auth,stocks,public;`);
  for (const u of users) if (u.banned_until && new Date(u.banned_until) > new Date()) {
    await db`UPDATE stocks.profiles SET disabled_at=now() WHERE id=${u.id}`;
  }
  if (emitFile) {
    statements.push("COMMIT;");
    await writeFile(emitFile, statements.join("\n"), { mode: 0o600 });
    await writeFile(emitFile + ".json", JSON.stringify(statements.slice(1,-1)), { mode: 0o600 });
    console.log("Private import SQL prepared; execute it on the empty validation branch and verify every comparison result.");
  } else {
    console.log(JSON.stringify({ users: users.length, tablesVerified: schema.tables.length, studies: source.find((x:any)=>x.name==="case_studies").rows.length, imported:true }));
  }
} finally { await db.end(); }
// Better Auth's migration pool otherwise keeps this one-shot tool alive.
process.exit(0);
}
main().catch(error => { console.error(error.message); process.exit(1); });
