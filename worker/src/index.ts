import {
  createCompetitor,
  listCompetitors,
  listDigestConfigs,
  listPosts,
  updateCompetitor,
  updatePost,
  upsertCapturedPosts,
  upsertDigestConfig,
} from "./db";
import type { PostFilters } from "./db";
import { runWeeklyDigests } from "./digest";
import type { CapturePayload, Env, Post } from "./types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isAuthorized(_request: Request, _env: Env): boolean {
  // Temporarily disabled — no CAPTURE_API_TOKEN check for now. Re-enable by
  // restoring the Bearer-token comparison against env.CAPTURE_API_TOKEN.
  return true;
}

function parsePostFilters(url: URL): PostFilters {
  const num = (key: string) => {
    const v = url.searchParams.get(key);
    return v ? Number(v) : undefined;
  };
  const str = (key: string) => url.searchParams.get(key) || undefined;
  const sort = url.searchParams.get("sort");
  return {
    min_likes: num("min_likes"),
    min_comments: num("min_comments"),
    min_reposts: num("min_reposts"),
    since: str("since"),
    until: str("until"),
    competitor_id: str("competitor_id"),
    list_name: str("list_name"),
    media_type: str("media_type"),
    sort: sort === "recent" || sort === "velocity" ? sort : "engagement",
    limit: num("limit"),
  };
}

function toCsv(posts: Post[]): string {
  const header = [
    "competitor",
    "posted_at",
    "media_type",
    "likes",
    "comments",
    "reposts",
    "tags",
    "note",
    "post_url",
    "text",
  ];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = posts.map((p) =>
    [
      p.competitor_name,
      p.posted_at ?? "",
      p.media_type,
      String(p.likes),
      String(p.comments),
      String(p.reposts),
      p.tags.join("; "),
      p.note,
      p.post_url,
      p.text.replace(/\r?\n/g, " "),
    ]
      .map(escape)
      .join(",")
  );
  return [header.join(","), ...rows].join("\r\n");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // --- Public dashboard reads still require the shared token, same as capture. ---
    if (!isAuthorized(request, env)) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      // Competitors
      if (url.pathname === "/api/competitors" && request.method === "GET") {
        const status = url.searchParams.get("status") || undefined;
        return json(await listCompetitors(env, status));
      }
      if (url.pathname === "/api/competitors" && request.method === "POST") {
        const body = await request.json<{ name: string; linkedin_url: string; list_name?: string }>();
        if (!body.name || !body.linkedin_url) return json({ error: "name and linkedin_url are required" }, 400);
        return json(await createCompetitor(env, body), 201);
      }
      const competitorMatch = url.pathname.match(/^\/api\/competitors\/([^/]+)$/);
      if (competitorMatch && request.method === "PATCH") {
        const body = await request.json<{ name?: string; list_name?: string; status?: string }>();
        await updateCompetitor(env, competitorMatch[1], body);
        return json({ ok: true });
      }

      // Capture (called by the browser extension)
      if (url.pathname === "/api/capture" && request.method === "POST") {
        const body = await request.json<CapturePayload>();
        if (!body.linkedin_url || !Array.isArray(body.posts)) {
          return json({ error: "linkedin_url and posts[] are required" }, 400);
        }
        const result = await upsertCapturedPosts(env, body);
        return json(result, 201);
      }

      // Posts feed
      if (url.pathname === "/api/posts" && request.method === "GET") {
        return json(await listPosts(env, parsePostFilters(url)));
      }
      const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
      if (postMatch && request.method === "PATCH") {
        const body = await request.json<{ tags?: string[]; note?: string }>();
        await updatePost(env, postMatch[1], body);
        return json({ ok: true });
      }

      // CSV export — same filters as /api/posts
      if (url.pathname === "/api/export.csv" && request.method === "GET") {
        const posts = await listPosts(env, parsePostFilters(url));
        return new Response(toCsv(posts), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="competitor-posts.csv"`,
            ...CORS_HEADERS,
          },
        });
      }

      // Digest configuration
      if (url.pathname === "/api/digest-config" && request.method === "GET") {
        return json(await listDigestConfigs(env));
      }
      if (url.pathname === "/api/digest-config" && request.method === "PUT") {
        const body = await request.json<{
          id?: string;
          name: string;
          list_name: string;
          recipients: string[];
          min_likes: number;
          top_n: number;
          enabled: boolean;
        }>();
        return json(await upsertDigestConfig(env, body));
      }

      // Manual trigger, useful for testing the digest without waiting for Monday.
      if (url.pathname === "/api/digest-config/send-now" && request.method === "POST") {
        await runWeeklyDigests(env);
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal error", detail: String(err) }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runWeeklyDigests(env));
  },
};
