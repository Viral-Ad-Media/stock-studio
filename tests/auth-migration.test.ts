import { test } from "node:test";
import assert from "node:assert/strict";
import { hash } from "bcryptjs";
import { hashPassword, verifyMigratedPassword } from "../lib/auth-password";
import { readFile, readdir } from "node:fs/promises";
import { getSchema } from "better-auth/db";
import { PGlite } from "@electric-sql/pglite";

test("legacy bcrypt and new scrypt credentials accept only the correct password", async () => {
  const password = "Test-only-password-5842";
  for (const encoded of [await hash(password, 10), await hashPassword(password)]) {
    assert.equal(await verifyMigratedPassword({hash:encoded,password}),true);
    assert.equal(await verifyMigratedPassword({hash:encoded,password:"incorrect"}),false);
  }
});

test("new signup provisions once, verifies email, and resets passwords with single-use tokens", async () => {
  const { buildAuth } = await import("../lib/auth");
  const db = new PGlite();
  process.env.AUTH_DATABASE_URL = "postgres://unused/test";
  process.env.BETTER_AUTH_URL = "http://localhost:3200";
  process.env.BETTER_AUTH_SECRET = "test-only-secret-32-characters-584251937";
  try {
    await db.exec(await readFile("db/identity.sql", "utf8"));
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role");
    for (const file of (await readdir("supabase/migrations")).filter(f => f.endsWith(".sql")).sort()) {
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    }
    await db.exec(await readFile("db/better-auth.sql", "utf8"));
    await db.exec("SET search_path=auth,stocks,public");
    const client = { query: async (sql: string, params?: any[]) => db.query(sql, params), release() {} };
    const mail: string[] = [];
    const auth = buildAuth({ connect: async () => client, end: async () => {}, on() {} } as any,
      async (_to, _subject, text) => { mail.push(text); });
    const post = (path: string, body: object) => auth.handler(new Request(`http://localhost:3200/api/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3200", "x-forwarded-for": "127.0.0.1" }, body: JSON.stringify(body),
    }));
    const email = "new@example.test", password = "New-test-password-58712";
    const response = await post("sign-up/email", { email, password, name: "New user", callbackURL: "/dashboard" });
    assert.equal(response.status, 200, await response.clone().text());
    const id = (await response.json()).user.id;
    assert.equal((await post("sign-in/email", { email, password })).status, 403);
    assert.equal(mail.length, 1);
    const verifyURL = mail[0].match(/http:\/\/\S+/)![0];
    const verified = await auth.handler(new Request(verifyURL));
    assert.equal(verified.status, 302);
    const beforeReset = await post("sign-in/email", { email, password });
    assert.equal(beforeReset.status, 200);
    const resetCookie = beforeReset.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const profile = (await db.query<any>("select active_workspace_id from stocks.profiles where id=$1", [id])).rows[0];
    assert.ok(profile.active_workspace_id);
    const credits = (await db.query<any>("select sum(delta)::int as credits from stocks.credits_ledger where workspace_id=$1", [profile.active_workspace_id])).rows[0].credits;
    assert.equal(credits, 5);
    assert.equal((await db.query<any>("select count(*)::int as n from stocks.workspace_members where user_id=$1", [id])).rows[0].n, 1);
    assert.equal((await post("request-password-reset", { email, redirectTo: "/reset-password" })).status, 200);
    const resetURL = new URL(mail[mail.length - 1].match(/http:\/\/\S+/)![0]);
    const token = resetURL.pathname.split("/").pop();
    const newPassword = "Changed-test-password-8714";
    assert.equal((await post("reset-password", { token, newPassword })).status, 200);
    assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: resetCookie }) }), null);
    assert.notEqual((await post("reset-password", { token, newPassword: password })).status, 200);
    assert.equal((await post("sign-in/email", { email, password })).status, 401);
    // The fourth handler sign-in hits the real per-path throttle. Exercise
    // password verification directly without disabling production rate limits.
    const signedIn = await auth.api.signInEmail({ body: { email, password: newPassword } });
    assert.equal(signedIn.user.id, id);
  } finally { await db.close(); }
});

test("identity tables cover the installed Better Auth schema and credential isolation", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile("db/identity.sql","utf8"));
    await db.exec(await readFile("db/better-auth.sql","utf8"));
    const schema = getSchema({user:{modelName:"users",fields:{emailVerified:"email_verified",createdAt:"created_at",updatedAt:"updated_at"}},session:{modelName:"sessions"},account:{modelName:"accounts"},verification:{modelName:"verifications"},rateLimit:{enabled:true,storage:"database"}});
    for (const [table, expected] of Object.entries(schema)) {
      const {rows} = await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='auth' and table_name=$1",[table]);
      const columns = new Set(rows.map(r=>r.column_name));
      for (const key of ["id",...Object.keys(expected.fields)]) assert.ok(columns.has(key),`${table}.${key}`);
    }
    const a="00000000-0000-0000-0000-000000000001";
    await db.query("insert into auth.users(id,email) values($1,'existing@example.test')",[a]);
    await db.query(`insert into auth.accounts("accountId","providerId","userId",password,"createdAt","updatedAt") values($1::text,'credential',$1::uuid,'hash',now(),now())`,[a]);
    await assert.rejects(db.query(`insert into auth.accounts("accountId","providerId","userId",password,"createdAt","updatedAt") values($1::text,'credential',$1::uuid,'other',now(),now())`,[a]),/unique/);
    await db.query("delete from auth.users where id=$1",[a]);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from auth.accounts")).rows[0].count,0);
  } finally {await db.close();}
});

test("real Better Auth handlers restore and revoke a migrated user's session", async () => {
  const { buildAuth } = await import("../lib/auth");
  const db = new PGlite();
  process.env.AUTH_DATABASE_URL = "postgres://unused/test";
  process.env.BETTER_AUTH_URL = "http://localhost:3200";
  process.env.BETTER_AUTH_SECRET = "test-only-secret-32-characters-584251937";
  try {
    await db.exec(await readFile("db/identity.sql","utf8"));
    await db.exec(await readFile("db/better-auth.sql","utf8"));
    const id="00000000-0000-0000-0000-000000000007";
    const password="Migrated-password-123";
    await db.query("insert into auth.users(id,email,name,email_verified) values($1,'migrated@example.test','Existing user',true)",[id]);
    await db.query(`insert into auth.accounts("accountId","providerId","userId",password,"createdAt","updatedAt") values($1::text,'credential',$1::uuid,$2,now(),now())`,[id,await hash(password,10)]);
    await db.exec("SET search_path=auth,stocks,public");
    const client = {query: async (sql:string,params?:any[]) => db.query(sql,params),release() {}};
    const pool = {connect:async()=>client,end:async()=>{},on:()=>{}};
    const auth=buildAuth(pool as any);
    const post=(path:string,body:object,cookie?:string)=>auth.handler(new Request(`http://localhost:3200/api/auth/${path}`,{method:"POST",headers:{"Content-Type":"application/json",Origin:"http://localhost:3200",...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
    const wrong=await post("sign-in/email",{email:"migrated@example.test",password:"wrong"});
    assert.equal(wrong.status,401);
    const response=await post("sign-in/email",{email:"migrated@example.test",password,rememberMe:false});
    assert.equal(response.status,200,await response.clone().text());
    const cookies=response.headers.getSetCookie();
    const sessionCookie=cookies.find(c=>c.startsWith("better-auth.session_token="));
    assert.ok(sessionCookie);
    assert.doesNotMatch(sessionCookie,/Max-Age=|Expires=/i);
    const cookie=cookies.map(c=>c.split(";")[0]).join("; ");
    const session=await auth.api.getSession({headers:new Headers({cookie})});
    assert.equal(session?.user.id,id);
    await post("sign-out",{},cookie);
    assert.equal(await auth.api.getSession({headers:new Headers({cookie})}),null);
  } finally {await db.close();}
});
