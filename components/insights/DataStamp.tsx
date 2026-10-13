import { dataAge, sourceTimestamp, timestampET } from "@/lib/data-freshness";

export default function DataStamp({ source, sourceAt, fetchedAt, delayed = false }: {
  source: string; sourceAt?: string | null; fetchedAt?: string | null; delayed?: boolean;
}) {
  const at = sourceTimestamp(sourceAt);
  const fetched = sourceTimestamp(fetchedAt);
  return (
    <div className="mt-3 space-y-1 text-xs text-fg-subtle">
      <p>Source: {source}{delayed && " · Delayed feed"}</p>
      <p>{at ? <>Source timestamp: <time dateTime={at}>{timestampET(at)}</time> · {dataAge(at)}</> : "Source time unavailable; retrieval time does not establish data freshness."}</p>
      {fetched && <p>Retrieved: <time dateTime={fetched}>{timestampET(fetched)}</time></p>}
    </div>
  );
}
