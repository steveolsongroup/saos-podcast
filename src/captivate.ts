/**
 * Minimal Captivate.fm API client.
 *
 * Endpoints verified against the official Captivate Postman collection
 * (https://docs.captivate.fm). Base URL + auth:
 *   POST /authenticate/token  (form: username=User ID, token=API Key) -> Bearer token
 *   POST /shows/:id/media     (multipart, field "file")               -> media id
 *   POST /episodes            (form fields)                           -> episode
 *   PUT  /episodes/:id        (form fields)                           -> episode
 *   GET  /users/:id/shows                                             -> shows
 *   GET  /insights/:showId/total[/:episodeId]                         -> all-time downloads
 *   GET  /insights/:showId/overview?start&end                        -> range downloads
 *
 * Mirrors the fetch + bearer style used elsewhere in Steve's codebase
 * (scaling-agent-os-web/lib/hubspot.ts): check `.ok`, throw on failure.
 */

const API_URL = "https://api.captivate.fm";

export interface EpisodeFields {
  shows_id: string;
  title: string;
  media_id: string;
  /** ISO-ish date string Captivate accepts, e.g. "2026-06-21 09:00:00". */
  date?: string;
  /** "Published" | "Draft" | "Scheduled" (Captivate accepts these). */
  status?: string;
  /** HTML show notes. */
  shownotes?: string;
  summary?: string;
  itunes_subtitle?: string;
  author?: string;
  explicit?: boolean;
  /** "Full" | "Trailer" | "Bonus" */
  episode_type?: string;
  episode_season?: number;
  episode_number?: number;
  link?: string;
}

/** Authenticate and return a short-lived Bearer token. */
export async function authenticate(userId: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("username", userId);
  form.append("token", apiKey);

  const res = await fetch(`${API_URL}/authenticate/token`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Captivate auth failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const token = data?.user?.token ?? data?.token;
  if (!token) {
    throw new Error(`Captivate auth returned no token: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return token as string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** List the shows a user owns. Used to discover the show id during setup. */
export async function getUserShows(token: string, userId: string): Promise<any[]> {
  const res = await fetch(`${API_URL}/users/${userId}/shows`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Captivate getUserShows failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data?.shows ?? data?.show ?? [];
}

/**
 * Upload audio bytes to a show's media library.
 * Returns the media id to attach to an episode.
 */
export async function uploadMedia(
  token: string,
  showId: string,
  bytes: Uint8Array | ArrayBuffer,
  filename: string,
  contentType = "audio/mpeg",
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  form.append("file", blob, filename);

  const res = await fetch(`${API_URL}/shows/${showId}/media`, {
    method: "POST",
    headers: authHeaders(token), // do NOT set Content-Type; fetch sets the multipart boundary
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Captivate uploadMedia failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const mediaId = data?.media?.id ?? data?.id ?? data?.media_id;
  if (!mediaId) {
    throw new Error(`Captivate uploadMedia returned no id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return String(mediaId);
}

function episodeForm(fields: EpisodeFields): FormData {
  const form = new FormData();
  const append = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    form.append(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  };
  append("shows_id", fields.shows_id);
  append("title", fields.title);
  append("media_id", fields.media_id);
  append("date", fields.date);
  append("status", fields.status);
  append("shownotes", fields.shownotes);
  append("summary", fields.summary);
  append("itunes_subtitle", fields.itunes_subtitle);
  append("author", fields.author);
  append("explicit", fields.explicit);
  append("episode_type", fields.episode_type);
  append("episode_season", fields.episode_season);
  append("episode_number", fields.episode_number);
  append("link", fields.link);
  return form;
}

export interface CreatedEpisode {
  id: string;
  /** Public episode URL if Captivate returned one. */
  url?: string;
  raw: any;
}

/** Create an episode. Returns its Captivate id (and public URL if available). */
export async function createEpisode(token: string, fields: EpisodeFields): Promise<CreatedEpisode> {
  const res = await fetch(`${API_URL}/episodes`, {
    method: "POST",
    headers: authHeaders(token),
    body: episodeForm(fields),
  });
  if (!res.ok) {
    throw new Error(`Captivate createEpisode failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const ep = data?.episode ?? data;
  const id = ep?.id ?? ep?.episode_id;
  if (!id) {
    throw new Error(`Captivate createEpisode returned no id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const url = ep?.episodes_url ?? ep?.url ?? ep?.link ?? ep?.share_url;
  return { id: String(id), url: url ? String(url) : undefined, raw: data };
}

/** Update an existing episode (used for idempotent retries). */
export async function updateEpisode(
  token: string,
  episodeId: string,
  fields: EpisodeFields,
): Promise<CreatedEpisode> {
  const res = await fetch(`${API_URL}/episodes/${episodeId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: episodeForm(fields),
  });
  if (!res.ok) {
    throw new Error(`Captivate updateEpisode failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const ep = data?.episode ?? data;
  const url = ep?.episodes_url ?? ep?.url ?? ep?.link ?? ep?.share_url;
  return { id: episodeId, url: url ? String(url) : undefined, raw: data };
}

// ---------------------------------------------------------------------------
// Analytics / insights
// ---------------------------------------------------------------------------

async function getJson(token: string, path: string): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`Captivate GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** All-time downloads for the whole show. Returns the raw insights payload. */
export function getShowTotal(token: string, showId: string): Promise<any> {
  return getJson(token, `/insights/${showId}/total`);
}

/** All-time downloads for a single episode. */
export function getEpisodeTotal(token: string, showId: string, episodeId: string): Promise<any> {
  return getJson(token, `/insights/${showId}/total/${episodeId}`);
}

/** Show overview between two YYYY-MM-DD dates (used for "last 30 days"). */
export function getShowOverview(
  token: string,
  showId: string,
  start: string,
  end: string,
): Promise<any> {
  return getJson(
    token,
    `/insights/${showId}/overview?start=${start}&end=${end}&includeTopEpisodes=true`,
  );
}

/** Per-episode overview between two YYYY-MM-DD dates. */
export function getEpisodeOverview(
  token: string,
  showId: string,
  episodeId: string,
  start: string,
  end: string,
): Promise<any> {
  return getJson(token, `/insights/${showId}/overview/${episodeId}?start=${start}&end=${end}`);
}

/**
 * Captivate's insights payloads vary in shape across endpoints. This walks a
 * response object and returns the first numeric value found under any of the
 * given candidate keys (case-insensitive), at any depth. Returns 0 if none.
 */
export function extractDownloads(
  payload: any,
  keys = ["hits", "downloads", "total", "count", "plays"],
): number {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  let found: number | undefined;

  const walk = (node: any) => {
    if (found !== undefined || node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (found !== undefined) return;
      if (typeof v === "number" && wanted.has(k.toLowerCase())) {
        found = v;
        return;
      }
      if (typeof v === "object") walk(v);
    }
  };

  walk(payload);
  return found ?? 0;
}
