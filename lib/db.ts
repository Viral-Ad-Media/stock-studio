import postgres from "postgres";
import dns from "dns";

// Hosted Postgres (Supabase, isolated `stocks` schema). The stocks_app role's
// search_path is set to stocks, so table names stay unqualified here.
// int8 → Number so ids and counts behave like plain JS numbers in JSON.

// Some local networks have a flaky default resolver (getaddrinfo/dns.lookup)
// that intermittently SERVFAILs on external hostnames even though the same
// host resolves fine via a direct DNS query. Prefer c-ares resolution against
// public resolvers, falling back to the OS resolver if that also fails —
// this only affects hostname lookups made by this process (postgres.js's
// socket connect included), not any system-wide DNS setting.
if (!(dns as any).__stocksPatchedLookup) {
  const originalLookup = dns.lookup.bind(dns);
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  (dns as any).lookup = (hostname: string, ...rest: any[]) => {
    const callback = rest[rest.length - 1];
    const opts = rest.length > 1 ? rest[0] : undefined;
    const wantsAll = typeof opts === "object" && opts?.all;
    dns.resolve4(hostname, (err, addresses) => {
      if (!err && addresses?.length) {
        callback(null, wantsAll ? addresses.map((a) => ({ address: a, family: 4 })) : addresses[0], 4);
      } else {
        (originalLookup as any)(hostname, opts, callback);
      }
    });
  };
  (dns as any).__stocksPatchedLookup = true;
}

declare global {
  // eslint-disable-next-line no-var
  var __stocksSql: ReturnType<typeof postgres> | undefined;
}

function createClient(url: string | undefined = process.env.DATABASE_URL, envName = "DATABASE_URL", max = 5) {
  if (!url) throw new Error(`${envName} is not set`);
  return postgres(url, {
    ssl: "require",
    prepare: false, // required for Supabase transaction pooler
    max,
    types: {
      bigint: {
        to: 20,
        from: [20],
        parse: (x: string) => Number(x),
        serialize: (x: number | bigint) => String(x),
      },
    },
  });
}

// Lazy init: `next build` imports route modules while collecting page data,
// and must not require DATABASE_URL. The client is created on first query.
function getClient() {
  if (!globalThis.__stocksSql) globalThis.__stocksSql = createClient();
  return globalThis.__stocksSql;
}

export const sql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply: (_target, _thisArg, args) => (getClient() as any)(...args),
  get: (_target, prop) => (getClient() as any)[prop],
}) as ReturnType<typeof postgres>;

declare global {
  // eslint-disable-next-line no-var
  var __stocksBillingSql: ReturnType<typeof postgres> | undefined;
}

// Separate connection for the Stripe webhook only, as the stocks_billing role:
// the one role allowed to call fulfill_checkout / refund_payment (the app's
// stocks_app role can't). Never use this anywhere else.
export const billingSql = new Proxy(function () {} as unknown as ReturnType<typeof postgres>, {
  apply: (_target, _thisArg, args) => (getBillingClient() as any)(...args),
  get: (_target, prop) => (getBillingClient() as any)[prop],
}) as ReturnType<typeof postgres>;

function getBillingClient() {
  if (!globalThis.__stocksBillingSql) {
    globalThis.__stocksBillingSql = createClient(process.env.BILLING_DATABASE_URL, "BILLING_DATABASE_URL", 2);
  }
  return globalThis.__stocksBillingSql;
}

export * from "./shared";
