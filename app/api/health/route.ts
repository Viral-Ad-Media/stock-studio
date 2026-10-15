// Lightweight instance readiness. No database, provider requests or secrets.
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
