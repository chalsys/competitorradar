export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CAPTURE_API_TOKEN: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
}

export type MediaType = "text" | "image" | "video" | "document" | "poll";

export interface Competitor {
  id: string;
  name: string;
  linkedin_url: string;
  list_name: string;
  status: "active" | "archived";
  website_url: string | null;
  created_at: string;
}

export interface CapturedPost {
  post_url: string;
  text: string;
  media_type: MediaType;
  posted_at: string | null;
  likes: number;
  comments: number;
  reposts: number;
}

export interface CapturePayload {
  linkedin_url: string;
  competitor_name?: string;
  list_name?: string;
  captured_by: string;
  posts: CapturedPost[];
}

export interface Post {
  id: string;
  competitor_id: string;
  competitor_name: string;
  post_url: string;
  text: string;
  media_type: MediaType;
  posted_at: string | null;
  likes: number;
  comments: number;
  reposts: number;
  first_captured_at: string;
  last_captured_at: string;
  captured_by: string | null;
  tags: string[];
  note: string;
}

export interface DigestConfig {
  id: string;
  name: string;
  list_name: string;
  recipients: string[];
  min_likes: number;
  top_n: number;
  enabled: boolean;
}

export interface ResearchNote {
  id: string;
  competitor_id: string;
  competitor_name: string;
  summary: string;
  source_url: string;
  created_at: string;
}
