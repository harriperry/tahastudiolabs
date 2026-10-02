/* Keeps the Brain Vault source folder (workers/) out of the public website.
   Cloudflare Pages serves every file in this repo as a static asset, so without this
   catch-all the Worker source, schemas and setup record would be readable at
   tahastudiolabs.com/workers/... The live Vault itself runs at /api/vault/*. */
export function onRequest() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
