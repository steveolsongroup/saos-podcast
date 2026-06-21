/**
 * Centralized environment configuration.
 *
 * Locally these come from a `.env` file (loaded by dotenv below). In CI they
 * come from GitHub Actions secrets, where no `.env` exists and dotenv no-ops.
 */
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export const env = {
  // Notion
  notionToken: () => required("NOTION_TOKEN"),
  podcastDb: () => required("NOTION_PODCAST_DB"),
  statsDb: () => required("NOTION_PODCAST_STATS_DB"),

  // Captivate
  captivateUserId: () => required("CAPTIVATE_USER_ID"),
  captivateApiKey: () => required("CAPTIVATE_API_KEY"),
  captivateShowId: () => required("CAPTIVATE_SHOW_ID"),

  // Optional: timezone used when stamping snapshot dates (defaults to UTC).
  timezone: () => optional("TIMEZONE") ?? "UTC",
};
