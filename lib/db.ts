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

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    ssl: "require",
    prepare: false, // required for Supabase transaction pooler
    max: 5,
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

export * from "./shared";
