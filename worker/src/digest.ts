import { listDigestConfigs, listPosts } from "./db";
import type { DigestConfig, Env, Post } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDigestHtml(config: DigestConfig, posts: Post[]): string {
  const rows = posts
    .map(
      (p) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;">
          <div style="font-weight:600;">${escapeHtml(p.competitor_name)}</div>
          <div style="color:#555;font-size:13px;margin-top:2px;">${escapeHtml(p.text.slice(0, 180))}${
        p.text.length > 180 ? "…" : ""
      }</div>
          <a href="${escapeHtml(p.post_url)}" style="font-size:12px;color:#1E6E68;">View post →</a>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e5e5;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;">
          ${p.likes} 👍 &nbsp; ${p.comments} 💬 &nbsp; ${p.reposts} 🔁
        </td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;">
    <h1 style="font-size:20px;margin-bottom:4px;">${escapeHtml(config.name)}</h1>
    <p style="color:#555;font-size:14px;margin-top:0;">
      Top ${posts.length} competitor post${posts.length === 1 ? "" : "s"} from the past 7 days
      with ${config.min_likes}+ likes.
    </p>
    <table style="width:100%;border-collapse:collapse;">
      ${rows || `<tr><td style="padding:16px 12px;color:#777;">No posts cleared the ${config.min_likes}-like bar this week.</td></tr>`}
    </table>
    <p style="color:#999;font-size:12px;margin-top:20px;">Competitor Post Radar — automated weekly digest</p>
  </div>`;
}

async function sendEmail(env: Env, to: string[], subject: string, html: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set — skipping digest send. Configure it with `wrangler secret put RESEND_API_KEY`.");
    return;
  }
  if (to.length === 0) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Digest send failed (${res.status}): ${body}`);
  }
}

export async function runWeeklyDigests(env: Env): Promise<void> {
  const configs = await listDigestConfigs(env);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const config of configs) {
    if (!config.enabled) continue;

    const posts = await listPosts(env, {
      min_likes: config.min_likes,
      since,
      list_name: config.list_name === "all" ? undefined : config.list_name,
      sort: "engagement",
      limit: config.top_n,
    });

    const html = renderDigestHtml(config, posts);
    const weekOf = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    await sendEmail(env, config.recipients, `${config.name} — week of ${weekOf}`, html);
  }
}
