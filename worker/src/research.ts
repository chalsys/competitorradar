import { insertResearchNote, listCompetitors } from "./db";
import type { Competitor, Env } from "./types";

const MAX_SOURCE_CHARS = 8000;
const FETCH_TIMEOUT_MS = 15000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CompetitorPostRadar/0.1)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return stripHtml(html).slice(0, MAX_SOURCE_CHARS);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeWithOpenRouter(env: Env, competitorName: string, pageText: string): Promise<string | null> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a competitive-intelligence analyst. Summarize only what is stated in the provided page text — do not invent facts. Write 3-5 short bullet points covering anything notable for tracking a competitor: product/feature announcements, pricing changes, hiring/funding/partnership news, positioning shifts. If nothing notable is present, say so in one line.",
        },
        { role: "user", content: `Competitor: ${competitorName}\n\nPage text:\n${pageText}` },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`OpenRouter request failed (${res.status}): ${await res.text()}`);
    return null;
  }
  const data = await res.json<{ choices?: { message?: { content?: string } }[] }>();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

export async function researchCompetitor(env: Env, competitor: Competitor): Promise<void> {
  if (!competitor.website_url) return;
  const pageText = await fetchPageText(competitor.website_url);
  if (!pageText) return;
  const summary = await summarizeWithOpenRouter(env, competitor.name, pageText);
  if (!summary) return;
  await insertResearchNote(env, {
    competitor_id: competitor.id,
    summary,
    source_url: competitor.website_url,
  });
}

export async function runWeeklyResearch(env: Env): Promise<void> {
  const competitors = await listCompetitors(env, "active");
  for (const competitor of competitors) {
    try {
      await researchCompetitor(env, competitor);
    } catch (err) {
      console.error(`Research failed for competitor ${competitor.id}`, err);
    }
  }
}
