interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
interface D1Database { prepare(query: string): D1Statement; }
interface AssetFetcher { fetch(request: Request): Promise<Response>; }
interface Env {
  ASSETS: AssetFetcher;
  DB?: D1Database;
  DEFAULT_CHOIR_SLUG?: string;
  MEMBER_CATALOG_AUTH?: string;
}
interface SongRow {
  id: string; title: string; slug: string; description: string | null; sort_order: number;
}
function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
async function resolveChoirSlug(request: Request, env: Env): Promise<string | undefined> {
  const hostname = new URL(request.url).hostname.toLowerCase();
  // workers.dev and local development use the explicitly configured Tabor default.
  // Custom production domains must be mapped explicitly in D1.
  if (hostname.endsWith(".workers.dev") || hostname === "localhost" || hostname === "127.0.0.1") {
    return env.DEFAULT_CHOIR_SLUG;
  }
  if (!env.DB) return undefined;
  try {
    const result = await env.DB.prepare(
      `SELECT c.slug
       FROM choir_domains AS d
       JOIN choirs AS c ON c.id = d.choir_id
       WHERE lower(d.hostname) = ? AND d.status = 'active' AND c.status = 'active'
       LIMIT 1`
    ).bind(hostname).all<{ slug: string }>();
    return result.results?.[0]?.slug;
  } catch {
    return undefined;
  }
}
async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    return json({
      ok: true, app: "choir-app",
      databaseConfigured: Boolean(env.DB),
      defaultChoirConfigured: Boolean(env.DEFAULT_CHOIR_SLUG)
    });
  }
  if (request.method === "GET" && path === "/api/songs") {
    // Fail closed until member sessions and choir membership authorization exist.
    // Do not expose the published catalog anonymously during the preview deployment.
    if (env.MEMBER_CATALOG_AUTH !== "enabled") {
      return json({
        error: "authentication_not_ready",
        message: "Catalogul va fi activat după implementarea autentificării membrilor."
      }, 503);
    }
    if (!env.DB) {
      return json({
        error: "database_not_configured",
        message: "Catalogul va fi disponibil după configurarea bazei de date D1."
      }, 503);
    }
    const choirSlug = await resolveChoirSlug(request, env);
    if (!choirSlug) return json({ error: "choir_host_not_configured" }, 404);
    try {
      // Metadata only for now. Session authorization and private asset delivery
      // must be implemented before publishing real member media.
      const result = await env.DB.prepare(
        `SELECT s.id, s.title, s.slug, s.description, s.sort_order
         FROM songs AS s
         JOIN choirs AS c ON c.id = s.choir_id
         WHERE c.slug = ? AND c.status = 'active' AND s.status = 'published'
         ORDER BY s.sort_order ASC, s.title COLLATE NOCASE ASC`
      ).bind(choirSlug).all<SongRow>();
      return json({ songs: result.results ?? [] });
    } catch {
      return json({
        error: "catalog_unavailable",
        message: "Catalogul nu este disponibil momentan."
      }, 503);
    }
  }
  return json({ error: "not_found" }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "method_not_allowed" }, 405);
      }
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
