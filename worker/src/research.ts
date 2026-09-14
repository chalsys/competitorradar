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

async function fetchPageText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CompetitorPostRadar/0.1)" },
    });
    if (!res.ok) throw new Error(`fetching ${url} returned ${res.status}`);
    const html = await res.text();
    return stripHtml(html).slice(0, MAX_SOURCE_CHARS);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`fetching ${url} timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err instanceof Error ? new Error(`fetching ${url} failed: ${err.message}`) : err;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeWithOpenRouter(env: Env, competitorName: string, pageText: string): Promise<string> {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY binding is not configured");
  const apiKey = await env.OPENROUTER_API_KEY.get();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(`OpenRouter request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json<{ choices?: { message?: { content?: string } }[] }>();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter returned an empty response");
  return content;
}

export async function researchCompetitor(env: Env, competitor: Competitor): Promise<void> {
  if (!competitor.website_url) throw new Error("no website_url set");
  const pageText = await fetchPageText(competitor.website_url);
  const summary = await summarizeWithOpenRouter(env, competitor.name, pageText);
  await insertResearchNote(env, {
    competitor_id: competitor.id,
    summary,
    source_url: competitor.website_url,
  });
}

export interface ResearchRunResult {
  researched: string[];
  failed: { competitor_id: string; name: string; error: string }[];
}

export async function runWeeklyResearch(env: Env): Promise<ResearchRunResult> {
  const competitors = await listCompetitors(env, "active");
  const researched: string[] = [];
  const failed: { competitor_id: string; name: string; error: string }[] = [];

  for (const competitor of competitors) {
    if (!competitor.website_url) continue;
    try {
      await researchCompetitor(env, competitor);
      researched.push(competitor.name);
    } catch (err) {
      console.error(`Research failed for competitor ${competitor.id}`, err);
      failed.push({
        competitor_id: competitor.id,
        name: competitor.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { researched, failed };
}
