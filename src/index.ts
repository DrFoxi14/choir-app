interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
  DB?: D1Database;
}

interface SongRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  sort_order: number;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      app: "choir-app",
      databaseConfigured: Boolean(env.DB)
    });
  }

  if (request.method === "GET" && path === "/api/songs") {
    if (!env.DB) {
      return json({
        error: "database_not_configured",
        message: "Catalogul va fi disponibil după configurarea bazei de date D1."
      }, 503);
    }

    try {
      const result = await env.DB.prepare(
        `SELECT id, title, slug, description, sort_order
         FROM songs
         WHERE status = 'published'
         ORDER BY sort_order ASC, title COLLATE NOCASE ASC`
      ).all<SongRow>();

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
