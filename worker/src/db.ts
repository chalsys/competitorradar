import type { CapturePayload, Competitor, DigestConfig, Env, Post } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function listCompetitors(env: Env, status?: string): Promise<Competitor[]> {
  const query = status
    ? env.DB.prepare("SELECT * FROM competitors WHERE status = ? ORDER BY name").bind(status)
    : env.DB.prepare("SELECT * FROM competitors ORDER BY name");
  const { results } = await query.all<Competitor>();
  return results;
}

export async function createCompetitor(
  env: Env,
  input: { name: string; linkedin_url: string; list_name?: string }
): Promise<Competitor> {
  const id = newId();
  const linkedin_url = normalizeUrl(input.linkedin_url);
  await env.DB.prepare(
    `INSERT INTO competitors (id, name, linkedin_url, list_name, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(id, input.name.trim(), linkedin_url, input.list_name?.trim() || "Default")
    .run();
  return { id, name: input.name.trim(), linkedin_url, list_name: input.list_name?.trim() || "Default", status: "active", created_at: new Date().toISOString() };
}

export async function updateCompetitor(
  env: Env,
  id: string,
  patch: { name?: string; list_name?: string; status?: string }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name.trim());
  }
  if (patch.list_name !== undefined) {
    fields.push("list_name = ?");
    values.push(patch.list_name.trim());
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
  }
  if (fields.length === 0) return;
  values.push(id);
  await env.DB.prepare(`UPDATE competitors SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

async function findOrCreateCompetitorByUrl(
  env: Env,
  linkedin_url: string,
  fallbackName: string,
  list_name?: string
): Promise<Competitor> {
  const normalized = normalizeUrl(linkedin_url);
  const existing = await env.DB.prepare("SELECT * FROM competitors WHERE linkedin_url = ?")
    .bind(normalized)
    .first<Competitor>();
  if (existing) return existing;
  return createCompetitor(env, { name: fallbackName, linkedin_url: normalized, list_name });
}

export interface CaptureResult {
  competitor: Competitor;
  created: number;
  updated: number;
}

export async function upsertCapturedPosts(env: Env, payload: CapturePayload): Promise<CaptureResult> {
  const competitor = await findOrCreateCompetitorByUrl(
    env,
    payload.linkedin_url,
    payload.competitor_name || payload.linkedin_url,
    payload.list_name
  );

  let created = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const post of payload.posts) {
    const postUrl = normalizeUrl(post.post_url);
    const existing = await env.DB.prepare(
      "SELECT id FROM posts WHERE competitor_id = ? AND post_url = ?"
    )
      .bind(competitor.id, postUrl)
      .first<{ id: string }>();

    let postId: string;
    if (existing) {
      postId = existing.id;
      await env.DB.prepare(
        `UPDATE posts SET text = ?, media_type = ?, posted_at = ?, likes = ?, comments = ?, reposts = ?,
           last_captured_at = ?, captured_by = ?
         WHERE id = ?`
      )
        .bind(
          post.text,
          post.media_type,
          post.posted_at,
          post.likes,
          post.comments,
          post.reposts,
          now,
          payload.captured_by,
          postId
        )
        .run();
      updated++;
    } else {
      postId = newId();
      await env.DB.prepare(
        `INSERT INTO posts
           (id, competitor_id, post_url, text, media_type, posted_at, likes, comments, reposts,
            first_captured_at, last_captured_at, captured_by, tags, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '')`
      )
        .bind(
          postId,
          competitor.id,
          postUrl,
          post.text,
          post.media_type,
          post.posted_at,
          post.likes,
          post.comments,
          post.reposts,
          now,
          now,
          payload.captured_by
        )
        .run();
      created++;
    }

    await env.DB.prepare(
      `INSERT INTO post_snapshots (id, post_id, likes, comments, reposts, captured_at, captured_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(newId(), postId, post.likes, post.comments, post.reposts, now, payload.captured_by)
      .run();
  }

  return { competitor, created, updated };
}

export interface PostFilters {
  min_likes?: number;
  min_comments?: number;
  min_reposts?: number;
  since?: string;
  until?: string;
  competitor_id?: string;
  list_name?: string;
  media_type?: string;
  sort?: "engagement" | "recent" | "velocity";
  limit?: number;
}

export async function listPosts(env: Env, filters: PostFilters): Promise<Post[]> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (filters.min_likes) {
    where.push("p.likes >= ?");
    values.push(filters.min_likes);
  }
  if (filters.min_comments) {
    where.push("p.comments >= ?");
    values.push(filters.min_comments);
  }
  if (filters.min_reposts) {
    where.push("p.reposts >= ?");
    values.push(filters.min_reposts);
  }
  if (filters.since) {
    where.push("p.posted_at >= ?");
    values.push(filters.since);
  }
  if (filters.until) {
    where.push("p.posted_at <= ?");
    values.push(filters.until);
  }
  if (filters.competitor_id) {
    where.push("p.competitor_id = ?");
    values.push(filters.competitor_id);
  }
  if (filters.list_name) {
    where.push("c.list_name = ?");
    values.push(filters.list_name);
  }
  if (filters.media_type) {
    where.push("p.media_type = ?");
    values.push(filters.media_type);
  }

  const orderBy =
    filters.sort === "recent"
      ? "p.posted_at DESC"
      : filters.sort === "velocity"
      ? "(p.likes + p.comments + p.reposts) * 1.0 / MAX(1, julianday('now') - julianday(p.posted_at)) DESC"
      : "(p.likes + p.comments + p.reposts) DESC";

  const limit = Math.min(filters.limit ?? 200, 500);

  const sql = `
    SELECT p.*, c.name AS competitor_name
    FROM posts p
    JOIN competitors c ON c.id = p.competitor_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  values.push(limit);

  const { results } = await env.DB.prepare(sql)
    .bind(...values)
    .all<Record<string, unknown>>();

  return results.map((row) => ({
    id: row.id as string,
    competitor_id: row.competitor_id as string,
    competitor_name: row.competitor_name as string,
    post_url: row.post_url as string,
    text: row.text as string,
    media_type: row.media_type as Post["media_type"],
    posted_at: (row.posted_at as string) ?? null,
    likes: row.likes as number,
    comments: row.comments as number,
    reposts: row.reposts as number,
    first_captured_at: row.first_captured_at as string,
    last_captured_at: row.last_captured_at as string,
    captured_by: (row.captured_by as string) ?? null,
    tags: JSON.parse((row.tags as string) || "[]"),
    note: (row.note as string) ?? "",
  }));
}

export async function updatePost(
  env: Env,
  id: string,
  patch: { tags?: string[]; note?: string }
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.tags !== undefined) {
    fields.push("tags = ?");
    values.push(JSON.stringify(patch.tags));
  }
  if (patch.note !== undefined) {
    fields.push("note = ?");
    values.push(patch.note);
  }
  if (fields.length === 0) return;
  values.push(id);
  await env.DB.prepare(`UPDATE posts SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function listDigestConfigs(env: Env): Promise<DigestConfig[]> {
  const { results } = await env.DB.prepare("SELECT * FROM digest_configs ORDER BY name").all<
    Record<string, unknown>
  >();
  return results.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    list_name: row.list_name as string,
    recipients: JSON.parse((row.recipients as string) || "[]"),
    min_likes: row.min_likes as number,
    top_n: row.top_n as number,
    enabled: Boolean(row.enabled),
  }));
}

export async function upsertDigestConfig(
  env: Env,
  input: {
    id?: string;
    name: string;
    list_name: string;
    recipients: string[];
    min_likes: number;
    top_n: number;
    enabled: boolean;
  }
): Promise<DigestConfig> {
  const id = input.id || newId();
  await env.DB.prepare(
    `INSERT INTO digest_configs (id, name, list_name, recipients, min_likes, top_n, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       list_name = excluded.list_name,
       recipients = excluded.recipients,
       min_likes = excluded.min_likes,
       top_n = excluded.top_n,
       enabled = excluded.enabled`
  )
    .bind(
      id,
      input.name,
      input.list_name,
      JSON.stringify(input.recipients),
      input.min_likes,
      input.top_n,
      input.enabled ? 1 : 0
    )
    .run();
  return { id, ...input };
}
