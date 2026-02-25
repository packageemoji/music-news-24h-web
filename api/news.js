import Parser from "rss-parser";

const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY;
const DEEPL_API_BASE = process.env.DEEPL_API_BASE || "https://api-free.deepl.com"; // Free: api-free, Pro: api
const FEEDS_CSV_URL = process.env.FEEDS_CSV_URL; // Google Sheets "Publish as CSV" URL

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "music-news-24h/1.0 (+vercel)" },
});

// -----------------------------
// Translation helpers (DeepL)
// -----------------------------
function looksEnglish(text = "") {
  const s = String(text);
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const nonSpace = (s.match(/\S/g) || []).length || 1;
  return letters / nonSpace > 0.45;
}

const tlCache = new Map(); // key -> { t, v: { titleJa, summaryJa } }
const TL_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function deeplTranslateToJA(texts) {
  if (!DEEPL_AUTH_KEY || !texts.length) return null;

  const url = `${DEEPL_API_BASE}/v2/translate`;
  const body = new URLSearchParams();

  for (const t of texts) body.append("text", t);
  body.append("target_lang", "JA");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `DeepL-Auth-Key ${DEEPL_AUTH_KEY}`,
    },
    body,
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`DeepL HTTP ${res.status}: ${msg.slice(0, 200)}`);
  }

  const json = await res.json();
  return (json.translations || []).map((t) => t.text);
}

// -----------------------------
// Feed source loading (Sheets CSV)
// -----------------------------
const FEEDS_FALLBACK = [
  { source: "Pitchfork (News)", url: "https://pitchfork.com/feed/feed-news/rss", defaultGenre: "Pop" },
  { source: "Pitchfork (Album Reviews)", url: "https://pitchfork.com/feed/feed-album-reviews/rss", defaultGenre: "Pop" },
  { source: "Mixmag", url: "https://mixmag.net/rss.xml", defaultGenre: "Techno" },
  { source: "The Quietus", url: "https://thequietus.com/feed", defaultGenre: "Experimental" },
  { source: "Stereogum", url: "https://www.stereogum.com/feed", defaultGenre: "Rock" },
  { source: "Consequence", url: "http://consequenceofsound.net/feed", defaultGenre: "Rock" },
  { source: "EDM.com", url: "https://edm.com/.rss/full/", defaultGenre: "House" },
  { source: "音楽ナタリー", url: "http://natalie.mu/music/feed/news", defaultGenre: "Japan" },
];

// CSV parser (quote-aware enough for common Sheets CSV)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }

    if (ch === "\r") {
      i++;
      continue;
    }

    cell += ch;
    i++;
  }

  // flush tail
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];

  const header = rows[0].map((s) => String(s).trim());
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    // skip blank lines
    if (!cols.some((c) => String(c).trim() !== "")) continue;

    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = (cols[c] ?? "").trim();
    }
    out.push(obj);
  }

  return out;
}

let feedsCache = { at: 0, feeds: FEEDS_FALLBACK };
const FEEDS_CACHE_MS = 10 * 60 * 1000; // 10min

async function loadFeeds() {
  const now = Date.now();
  if (feedsCache.feeds && now - feedsCache.at < FEEDS_CACHE_MS) return feedsCache.feeds;

  if (!FEEDS_CSV_URL) {
    feedsCache = { at: now, feeds: FEEDS_FALLBACK };
    return feedsCache.feeds;
  }

  try {
    const res = await fetch(FEEDS_CSV_URL, { method: "GET" });
    if (!res.ok) throw new Error(`FEEDS CSV HTTP ${res.status}`);

    const csv = await res.text();
    const rows = parseCsv(csv);

    // expected headers: enabled,source,url,defaultGenre
    const feeds = rows
      .filter((r) => {
        const enabled = String(r.enabled ?? "").trim().toUpperCase();
        // blank = enabled 扱い / FALSE だけ無効
        return enabled !== "FALSE";
      })
      .map((r) => ({
        source: String(r.source ?? "").trim(),
        url: String(r.url ?? "").trim(),
        defaultGenre: String(r.defaultGenre ?? "Other").trim() || "Other",
      }))
      .filter((f) => f.source && f.url);

    feedsCache = { at: now, feeds: feeds.length ? feeds : FEEDS_FALLBACK };
    return feedsCache.feeds;
  } catch (e) {
    console.warn("loadFeeds failed:", e?.message || e);
    feedsCache = { at: now, feeds: FEEDS_FALLBACK };
    return feedsCache.feeds;
  }
}

// -----------------------------
// Genre rules
// -----------------------------
const GENRES = [
  { name: "Techno", keywords: ["techno", "テクノ"] },
  { name: "House", keywords: ["house", "ハウス", "deep house", "ディープハウス"] },
  { name: "Drum & Bass", keywords: ["drum & bass", "dnb", "drum and bass", "ドラムンベース"] },
  { name: "Dubstep", keywords: ["dubstep", "ダブステップ"] },
  { name: "UK Garage", keywords: ["ukg", "garage", "uk garage", "2-step", "2step", "ガラージ", "ツーステップ"] },
  { name: "Ambient", keywords: ["ambient", "アンビエント"] },
  { name: "Experimental", keywords: ["experimental", "avant", "アヴァン", "実験", "noise", "ノイズ"] },
  { name: "Hip-Hop", keywords: ["hip-hop", "hip hop", "rap", "ラップ", "ヒップホップ"] },
  { name: "Metal", keywords: ["metal", "hardcore", "ハードコア", "メタル"] },
  { name: "Rock", keywords: ["rock", "indie", "punk", "ロック", "パンク"] },
  { name: "Pop", keywords: ["pop", "アイドル", "シングル", "mv", "music video"] },
  { name: "Japan", keywords: ["日本", "東京", "渋谷", "j-pop", "邦楽"] },
];

function pickGenre({ title, source, fallback }) {
  const text = `${title} ${source}`.toLowerCase();
  for (const g of GENRES) {
    for (const kw of g.keywords) {
      if (text.includes(kw.toLowerCase())) return g.name;
    }
  }
  return fallback || "Other";
}

function toIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

// -----------------------------
// Vercel Function Handler
// -----------------------------
export default async function handler(req, res) {
  try {
    const hours = Math.max(1, Math.min(72, Number(req.query?.hours ?? 24)));
    const since = Date.now() - hours * 60 * 60 * 1000;

    const FEEDS = await loadFeeds();

    const allItems = [];

    await Promise.allSettled(
      FEEDS.map(async (f) => {
        try {
          const feed = await parser.parseURL(f.url);
          for (const it of feed.items || []) {
            const publishedRaw = it.isoDate || it.pubDate || it.published || it.updated;
            const publishedMs = publishedRaw ? new Date(publishedRaw).getTime() : NaN;
            if (!Number.isFinite(publishedMs) || publishedMs < since) continue;

            const title = (it.title || "").trim();
            const url = (it.link || it.guid || "").trim();
            if (!title || !url) continue;

            allItems.push({
              id: `${f.source}::${url}`,
              title,
              url,
              source: f.source,
              publishedAt: toIso(publishedRaw),
              summary: (it.contentSnippet || it.summary || "").toString().replace(/\s+/g, " ").trim().slice(0, 240) || null,
              _fallbackGenre: f.defaultGenre,
            });
          }
        } catch (e) {
          console.warn(`feed fetch failed [${f.source}]`, e?.message || e);
        }
      })
    );

    // Optional de-duplication by URL (keeps first/newest occurrence)
    const seen = new Set();
    const deduped = [];
    for (const item of allItems.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""))) {
      const key = item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    // --- translate EN items (title + summary) ---
    try {
      const targets = deduped.filter((it) => looksEnglish(it.title));
      const now = Date.now();

      // コスト/速度対策：翻訳対象の上限（必要なら調整）
      const TRANSLATE_LIMIT = 40;
      const limitedTargets = targets.slice(0, TRANSLATE_LIMIT);

      const need = [];
      const index = []; // [targetIndex, cacheKey]

      for (let i = 0; i < limitedTargets.length; i++) {
        const t = limitedTargets[i];
        const key = `${t.title}|||${t.summary || ""}`;

        const hit = tlCache.get(key);
        if (hit && now - hit.t < TL_TTL_MS) {
          t.titleJa = hit.v.titleJa;
          t.summaryJa = hit.v.summaryJa;
          continue;
        }

        index.push([i, key]);
        need.push(t.title);
        need.push((t.summary || "").slice(0, 400));
      }

      if (need.length && DEEPL_AUTH_KEY) {
        const out = await deeplTranslateToJA(need);
        if (out && out.length) {
          for (let k = 0; k < index.length; k++) {
            const [i, key] = index[k];
            const titleJa = out[k * 2] || null;
            const summaryJa = out[k * 2 + 1] || null;
            limitedTargets[i].titleJa = titleJa;
            limitedTargets[i].summaryJa = summaryJa;
            tlCache.set(key, { t: now, v: { titleJa, summaryJa } });
          }
        }
      }
    } catch (e) {
      // 翻訳失敗してもニュース取得は返す
      console.warn("translate failed:", e?.message || e);
    }

    const genres = {};
    for (const it of deduped) {
      const g = pickGenre({ title: it.title, source: it.source, fallback: it._fallbackGenre });
      if (!genres[g]) genres[g] = [];
      const { _fallbackGenre, ...clean } = it;
      genres[g].push(clean);
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      hours,
      feedCount: FEEDS.length,
      totalItems: deduped.length,
      feedsLoaded: FEEDS, // ← 追加（確認用）
      genres,
    });;
  } catch (e) {
    console.error("handler failed:", e?.message || e);
    res.status(500).json({
      error: "Internal Server Error",
      message: e?.message || String(e),
    });
  }
}