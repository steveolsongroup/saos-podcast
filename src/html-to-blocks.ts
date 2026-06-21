/**
 * Convert Captivate show-notes HTML into Notion block objects (the reverse of
 * src/shownotes.ts). Handles the common authoring tags used in episode
 * descriptions: paragraphs, headings, lists, blockquotes, line breaks, and
 * inline bold / italic / links. Unknown tags are stripped to plain text so
 * nothing is dropped.
 */

const MAX_TEXT = 1900; // Notion caps a rich_text content string at 2000 chars

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

interface RT {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: { bold?: boolean; italic?: boolean };
}

/** Parse an inline HTML fragment into Notion rich_text objects. */
function parseInline(html: string): RT[] {
  // Normalize line breaks and drop tags we don't model inline.
  const normalized = html.replace(/<br\s*\/?>/gi, "\n");
  const out: RT[] = [];
  let bold = false;
  let italic = false;
  let href: string | null = null;

  const re = /<(\/?)(strong|b|em|i|a)([^>]*)>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    if (m[4] !== undefined) {
      const content = decodeEntities(m[4]);
      if (!content) continue;
      for (let i = 0; i < content.length; i += MAX_TEXT) {
        const chunk = content.slice(i, i + MAX_TEXT);
        const rt: RT = { type: "text", text: { content: chunk } };
        if (href) rt.text.link = { url: href };
        if (bold || italic) rt.annotations = { bold, italic };
        out.push(rt);
      }
    } else {
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrs = m[3] || "";
      if (tag === "strong" || tag === "b") bold = !closing;
      else if (tag === "em" || tag === "i") italic = !closing;
      else if (tag === "a") {
        if (closing) href = null;
        else {
          const h = /href\s*=\s*"([^"]*)"/i.exec(attrs);
          href = h ? decodeEntities(h[1]) : null;
        }
      }
    }
  }
  return out;
}

const para = (rich: RT[]) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rich } });

function block(type: string, rich: RT[]) {
  return { object: "block", type, [type]: { rich_text: rich } } as any;
}

/** Convert show-notes HTML into an array of Notion block objects. */
export function htmlToBlocks(html: string): any[] {
  if (!html || !html.trim()) return [];

  // Flatten wrappers we don't model.
  const cleaned = html
    .replace(/<\/?(div|span|section|article)[^>]*>/gi, "")
    .replace(/<hr\s*\/?>/gi, "<hr></hr>");

  const blocks: any[] = [];
  const blockRe = /<(p|h1|h2|h3|h4|ul|ol|blockquote|hr)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushStray = (text: string) => {
    const stray = text.replace(/<[^>]+>/g, "").trim();
    if (stray) {
      const rich = parseInline(stray);
      if (rich.length) blocks.push(para(rich));
    }
  };

  while ((m = blockRe.exec(cleaned)) !== null) {
    pushStray(cleaned.slice(lastIndex, m.index));
    lastIndex = blockRe.lastIndex;

    const tag = m[1].toLowerCase();
    const inner = m[3];

    if (tag === "hr") {
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const liType = tag === "ul" ? "bulleted_list_item" : "numbered_list_item";
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      while ((li = liRe.exec(inner)) !== null) {
        const rich = parseInline(li[1]);
        if (rich.length) blocks.push(block(liType, rich));
      }
      continue;
    }

    const rich = parseInline(inner);
    if (!rich.length) continue;
    switch (tag) {
      case "p":
        blocks.push(para(rich));
        break;
      case "h1":
      case "h2":
        blocks.push(block("heading_2", rich)); // H1 reserved for the page title
        break;
      case "h3":
      case "h4":
        blocks.push(block("heading_3", rich));
        break;
      case "blockquote":
        blocks.push(block("quote", rich));
        break;
    }
  }
  pushStray(cleaned.slice(lastIndex));

  return blocks;
}
