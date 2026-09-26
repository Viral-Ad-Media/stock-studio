// The Supabase SDK is the largest client bundle (~260 KB). Auth pages and the
// app nav only need it when someone submits a form or signs out, so it's
// fetched on first use instead of with the page.
export async function getSupabase() {
  const { createClient } = await import("./client");
  return createClient();
}
