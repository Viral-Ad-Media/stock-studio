import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

async function freshDb() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz DEFAULT now(),last_sign_in_at timestamptz);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;`);
  for (const name of (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  }
  return db;
}

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000b2";

async function addUser(db: PGlite, id: string, email: string) {
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [id, email]);
}
const balanceOf = async (db: PGlite, user: string) =>
  Number(
    (
      await db.query<{ b: number }>(
        "SELECT coalesce(sum(l.delta),0)::int AS b FROM stocks.credits_ledger l JOIN stocks.profiles p ON p.active_workspace_id=l.workspace_id WHERE p.id=$1",
        [user],
      )
    ).rows[0].b,
  );

test("admin invites apply on signup, or straight away for an existing login", async () => {
  const db = await freshDb();
  try {
    await addUser(db, ADMIN, "admin@example.test");
    await db.query("INSERT INTO stocks.platform_admins(user_id) VALUES($1)", [ADMIN]);

    const invited = (
      await db.query<any>("SELECT * FROM stocks.admin_create_user($1,' New@Example.test ',20,60,true,'comp for partner')", [ADMIN])
    ).rows[0];
    assert.equal(invited.status, "invited");
    await assert.rejects(
      db.query("SELECT * FROM stocks.admin_create_user($1,'new@example.test',0,null,false,'again')", [ADMIN]),
      /open invite/,
    );

    // Signup trigger claims it: trial credits + invite credits, access, longer trial.
    const newUser = "00000000-0000-0000-0000-0000000000c3";
    await addUser(db, newUser, "NEW@example.test");
    assert.equal(await balanceOf(db, newUser), 25);
    const p = (await db.query<any>("SELECT access_granted, trial_ends_at > now() + interval '59 days' AS long_trial FROM stocks.profiles WHERE id=$1", [newUser])).rows[0];
    assert.equal(p.access_granted, true);
    assert.equal(p.long_trial, true);
    assert.equal((await db.query<any>("SELECT claimed_by FROM stocks.admin_invites")).rows[0].claimed_by, newUser);

    // A login from another app on the shared project: set up immediately.
    await db.exec("ALTER TABLE auth.users DISABLE TRIGGER stocks_auth_user_created");
    await addUser(db, OTHER, "other@example.test");
    await db.exec("ALTER TABLE auth.users ENABLE TRIGGER stocks_auth_user_created");
    const provisioned = (
      await db.query<any>("SELECT * FROM stocks.admin_create_user($1,'other@example.test',3,null,false,'existing login')", [ADMIN])
    ).rows[0];
    assert.equal(provisioned.status, "provisioned");
    assert.equal(provisioned.user_id, OTHER);
    assert.equal(await balanceOf(db, OTHER), 8);
    await assert.rejects(
      db.query("SELECT * FROM stocks.admin_create_user($1,'other@example.test',0,null,false,'dupe')", [ADMIN]),
      /already has a Stock Studio account/,
    );

    // Revoked invites are not applied.
    const inv = (await db.query<any>("SELECT * FROM stocks.admin_create_user($1,'later@example.test',50,null,false,'maybe')", [ADMIN])).rows[0];
    await db.query("SELECT stocks.admin_revoke_invite($1,$2,'changed my mind')", [ADMIN, inv.invite_id]);
    const later = "00000000-0000-0000-0000-0000000000d4";
    await addUser(db, later, "later@example.test");
    assert.equal(await balanceOf(db, later), 5);

    await assert.rejects(db.query("SELECT * FROM stocks.admin_create_user($1,'x@example.test',0,null,false,'not admin')", [OTHER]), /not a platform admin/);
    await assert.rejects(db.query("SELECT * FROM stocks.admin_create_user($1,'not-an-email',0,null,false,'bad')", [ADMIN]), /valid email/);
  } finally {
    await db.close();
  }
});

test("disable, admin role and remove", async () => {
  const db = await freshDb();
  try {
    await addUser(db, ADMIN, "admin@example.test");
    await addUser(db, OTHER, "other@example.test");
    await db.query("INSERT INTO stocks.platform_admins(user_id) VALUES($1)", [ADMIN]);

    await assert.rejects(db.query("SELECT stocks.admin_set_disabled($1,$1,true,'self')", [ADMIN]), /own account/);
    await db.query("SELECT stocks.admin_set_disabled($1,$2,true,'abuse report')", [ADMIN, OTHER]);
    const d = (await db.query<any>("SELECT disabled_at IS NOT NULL AS off, disabled_reason FROM stocks.profiles WHERE id=$1", [OTHER])).rows[0];
    assert.deepEqual(d, { off: true, disabled_reason: "abuse report" });
    await assert.rejects(db.query("SELECT stocks.admin_set_platform_admin($1,$2,true,'promote')", [ADMIN, OTHER]), /enable the account/);
    await db.query("SELECT stocks.admin_set_disabled($1,$2,false,'resolved')", [ADMIN, OTHER]);

    await db.query("SELECT stocks.admin_set_platform_admin($1,$2,true,'second admin')", [ADMIN, OTHER]);
    await assert.rejects(db.query("SELECT stocks.admin_set_platform_admin($1,$1,false,'self')", [ADMIN]), /own admin role/);
    // A disabled admin loses admin powers.
    await db.query("SELECT stocks.admin_set_disabled($1,$2,true,'locked')", [OTHER, ADMIN]);
    await assert.rejects(db.query("SELECT stocks.admin_set_disabled($1,$2,false,'unlock me')", [ADMIN, ADMIN]), /not a platform admin/);
    await db.query("SELECT stocks.admin_set_disabled($1,$2,false,'unlocked')", [OTHER, ADMIN]);
    await assert.rejects(db.query("SELECT stocks.admin_remove_user($1,$2,'other@example.test','remove')", [ADMIN, OTHER]), /admin role first/);
    await db.query("SELECT stocks.admin_set_platform_admin($1,$2,false,'demote')", [ADMIN, OTHER]);

    // Remove: needs the exact email, refuses accounts with payments.
    const ws = (await db.query<any>("SELECT active_workspace_id AS ws FROM stocks.profiles WHERE id=$1", [OTHER])).rows[0].ws;
    await db.query("INSERT INTO stocks.case_studies(workspace_id,ticker,variant) VALUES($1,'TEST','one_candle')", [ws]);
    await assert.rejects(db.query("SELECT stocks.admin_remove_user($1,$2,'wrong@example.test','remove')", [ADMIN, OTHER]), /to confirm/);
    await db.query("SELECT stocks.fulfill_checkout('cs_1','pi_1',$1,$2,'credits',100,10)", [ws, OTHER]);
    await assert.rejects(db.query("SELECT stocks.admin_remove_user($1,$2,'other@example.test','remove')", [ADMIN, OTHER]), /payment records/);
    await db.exec("DELETE FROM stocks.payments");
    await db.query("SELECT stocks.admin_remove_user($1,$2,' Other@Example.test ','requested deletion')", [ADMIN, OTHER]);
    assert.equal((await db.query("SELECT 1 FROM stocks.profiles WHERE id=$1", [OTHER])).rows.length, 0);
    assert.equal((await db.query("SELECT 1 FROM stocks.workspaces WHERE id=$1", [ws])).rows.length, 0);
    assert.equal((await db.query("SELECT 1 FROM stocks.case_studies")).rows.length, 0);
    assert.equal((await db.query("SELECT 1 FROM auth.users WHERE id=$1", [OTHER])).rows.length, 1);
    const audit = (await db.query<any>("SELECT action FROM stocks.admin_audit ORDER BY id")).rows.map((r) => r.action);
    assert.deepEqual(audit.slice(-2), ["revoke_admin", "remove_user"]);

    // Only stocks_admin may call the write functions.
    for (const role of ["anon", "authenticated", "stocks_app"]) {
      for (const fn of [
        "stocks.admin_create_user(uuid,text,integer,integer,boolean,text)",
        "stocks.admin_set_disabled(uuid,uuid,boolean,text)",
        "stocks.admin_set_platform_admin(uuid,uuid,boolean,text)",
        "stocks.admin_remove_user(uuid,uuid,text,text)",
        "stocks.admin_revoke_invite(uuid,bigint,text)",
      ]) {
        assert.equal((await db.query<any>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [role, fn])).rows[0].ok, false, `${role} ${fn}`);
      }
    }
    assert.equal((await db.query<any>("SELECT has_table_privilege('stocks_app','stocks.admin_invites','INSERT') AS ok")).rows[0].ok, false);
  } finally {
    await db.close();
  }
});
