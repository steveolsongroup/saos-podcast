/**
 * Notion client + helpers for the podcast integration.
 *
 * Property names here MUST match the "Podcast Episodes" and "Podcast Stats"
 * databases. Centralized in PROP / STATS_PROP so a rename is a one-line change.
 */

import { Client } from "@notionhq/client";
import { env } from "./env.js";

export const notion = new Client({ auth: env.notionToken() });

/** Property names on the Podcast Episodes DB. */
export const PROP = {
  title: "Title",
  status: "Status",
  audio: "Audio",
  publishDate: "Publish Date",
  episodeNumber: "Episode Number",
  season: "Season",
  episodeType: "Episode Type",
  summary: "Summary",
  explicit: "Explicit",
  episodeArt: "Episode Art",
  captivateEpisodeId: "Captivate Episode ID",
  captivateMediaId: "Captivate Media ID",
  episodeUrl: "Episode URL",
  playerUrl: "Player URL",
  mp3Url: "MP3 URL",
  error: "Error",
  downloadsTotal: "Downloads (Total)",
  downloads30d: "Downloads (30d)",
  lastSynced: "Last Synced",
} as const;

/** Property names on the Podcast Stats DB. */
export const STATS_PROP = {
  snapshot: "Snapshot", // title (human label, e.g. the date string)
  date: "Date", // real date property (chart x-axis)
  total: "Total Downloads",
  last30: "Downloads (30d)",
  episodes: "Episodes",
} as const;

export const STATUS = {
  draft: "Draft",
  ready: "Ready to Publish",
  publishing: "Publishing",
  published: "Published",
  error: "Error",
} as const;

/** Captivate's embeddable player URL for an episode (deterministic from its id). */
export const captivatePlayerUrl = (episodeId: string): string =>
  `https://player.captivate.fm/episode/${episodeId}/`;

export interface EpisodeRow {
  id: string;
  title: string;
  status: string;
  audioUrl?: string;
  audioName?: string;
  publishDate?: string;
  episodeNumber?: number;
  season?: number;
  episodeType?: string;
  summary?: string;
  explicit: boolean;
  captivateEpisodeId?: string;
  captivateMediaId?: string;
}

// --- property extractors -------------------------------------------------

const getTitle = (p: any): string => (p?.title ?? []).map((t: any) => t.plain_text).join("").trim();
const getText = (p: any): string => (p?.rich_text ?? []).map((t: any) => t.plain_text).join("").trim();
const getSelect = (p: any): string => p?.select?.name ?? "";
const getNumber = (p: any): number | undefined => (typeof p?.number === "number" ? p.number : undefined);
const getCheckbox = (p: any): boolean => p?.checkbox === true;
const getDate = (p: any): string | undefined => p?.date?.start ?? undefined;

/** First file in a files property -> { url, name }. Handles Notion-hosted + external. */
function getFirstFile(p: any): { url?: string; name?: string } {
  const f = (p?.files ?? [])[0];
  if (!f) return {};
  const url = f.type === "external" ? f.external?.url : f.file?.url;
  return { url, name: f.name };
}

function mapRow(page: any): EpisodeRow {
  const props = page.properties;
  const audio = getFirstFile(props[PROP.audio]);
  return {
    id: page.id,
    title: getTitle(props[PROP.title]),
    status: getSelect(props[PROP.status]),
    audioUrl: audio.url,
    audioName: audio.name,
    publishDate: getDate(props[PROP.publishDate]),
    episodeNumber: getNumber(props[PROP.episodeNumber]),
    season: getNumber(props[PROP.season]),
    episodeType: getSelect(props[PROP.episodeType]),
    summary: getText(props[PROP.summary]),
    explicit: getCheckbox(props[PROP.explicit]),
    captivateEpisodeId: getText(props[PROP.captivateEpisodeId]) || undefined,
    captivateMediaId: getText(props[PROP.captivateMediaId]) || undefined,
  };
}

// --- queries -------------------------------------------------------------

/** Episodes the user has marked "Ready to Publish". */
export async function getReadyEpisodes(): Promise<EpisodeRow[]> {
  const res = await notion.databases.query({
    database_id: env.podcastDb(),
    filter: { property: PROP.status, select: { equals: STATUS.ready } },
  });
  return res.results.map(mapRow);
}

/** Published episodes that have a Captivate id (for stats sync). */
export async function getPublishedEpisodes(): Promise<EpisodeRow[]> {
  const rows: EpisodeRow[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: env.podcastDb(),
      filter: { property: PROP.captivateEpisodeId, rich_text: { is_not_empty: true } },
      start_cursor: cursor,
      page_size: 100,
    });
    rows.push(...res.results.map(mapRow));
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return rows;
}

// --- write-backs ---------------------------------------------------------

const textProp = (s: string) => ({ rich_text: [{ text: { content: s.slice(0, 2000) } }] });

export async function setStatus(pageId: string, status: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: { [PROP.status]: { select: { name: status } } },
  });
}

export async function saveMediaId(pageId: string, mediaId: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: { [PROP.captivateMediaId]: textProp(mediaId) },
  });
}

export async function markPublished(
  pageId: string,
  opts: { episodeId: string; mediaId: string; url?: string; mp3Url?: string },
): Promise<void> {
  const properties: Record<string, any> = {
    [PROP.status]: { select: { name: STATUS.published } },
    [PROP.captivateEpisodeId]: textProp(opts.episodeId),
    [PROP.captivateMediaId]: textProp(opts.mediaId),
    [PROP.playerUrl]: { url: captivatePlayerUrl(opts.episodeId) },
    [PROP.error]: { rich_text: [] },
  };
  if (opts.url) properties[PROP.episodeUrl] = { url: opts.url };
  if (opts.mp3Url) properties[PROP.mp3Url] = { url: opts.mp3Url };
  await notion.pages.update({ page_id: pageId, properties });
}

export async function markError(pageId: string, message: string): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      [PROP.status]: { select: { name: STATUS.error } },
      [PROP.error]: textProp(message),
    },
  });
}

export async function updateEpisodeStats(
  pageId: string,
  opts: { total: number; last30: number; syncedAt: string },
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      [PROP.downloadsTotal]: { number: opts.total },
      [PROP.downloads30d]: { number: opts.last30 },
      [PROP.lastSynced]: { date: { start: opts.syncedAt } },
    },
  });
}

export async function appendStatsSnapshot(opts: {
  date: string;
  total: number;
  last30: number;
  episodes: number;
}): Promise<void> {
  await notion.pages.create({
    parent: { database_id: env.statsDb() },
    properties: {
      [STATS_PROP.snapshot]: { title: [{ text: { content: opts.date } }] },
      [STATS_PROP.date]: { date: { start: opts.date } },
      [STATS_PROP.total]: { number: opts.total },
      [STATS_PROP.last30]: { number: opts.last30 },
      [STATS_PROP.episodes]: { number: opts.episodes },
    },
  });
}
