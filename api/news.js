import Parser from "rss-parser";

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "music-news-24h/1.0 (+vercel)" },
});

const FEEDS = [
  { source: "Pitchfork (News)", url: "https://pitchfork.com/feed/feed-news/rss", defaultGenre: "Pop" },
  { source: "Pitchfork (Album Reviews)", url: "https://pitchfork.com/feed/feed-album-reviews/rss", defaultGenre: "Pop" },
  { source: "Mixmag", url: "https://mixmag.net/rss.xml", defaultGenre: "Techno" },
  { source: "The Quietus", url: "https://thequietus.com/feed", defaultGenre: "Experimental" },
  { source: "Stereogum", url: "https://www.stereogum.com/feed", defaultGenre: "Rock" },
  { source: "Consequence", url: "http://consequenceofsound.net/feed", defaultGenre: "Rock" },
  { source: "EDM.com", url: "https://edm.com/.rss/full/", defaultGenre: "House" },
  { source: "音楽ナタリー", url: "http://natalie.mu/music/feed/news", defaultGenre: "Japan" },
];

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
  { name: "Japan", keywords: ["日本", "東京", "渋谷", "J-POP", "邦楽"] },
];

function pickGenre({ title, source, fallback }) {
  const text = `${title} ${source}`.toLowerCase();
  for (const g of GENRES) for (const kw of g.keywords) if (text.includes(kw.toLowerCase())) return g.name;
  return fallback || "Other";
}

function toIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

// Vercel Function (Node.js runtime): export default (req, res) => {}
export default async function handler(req, res) {
  const hours = Math.max(1, Math.min(72, Number(req.query?.hours ?? 24)));
  const since = Date.now() - hours * 60 * 60 * 1000;

  const allItems = [];
  await Promise.allSettled(
    FEEDS.map(async (f) => {
      const feed = await parser.parseURL(f.url);
      for (const it of feed.items || []) {
        const publishedRaw = it.isoDate || it.pubDate || it.published || it.updated;
        const published = publishedRaw ? new Date(publishedRaw).getTime() : NaN;
        if (!Number.isFinite(published) || published < since) continue;

        const title = (it.title || "").trim();
        const url = (it.link || it.guid || "").trim();
        if (!title || !url) continue;

        allItems.push({
          id: `${f.source}::${url}`,
          title,
          url,
          source: f.source,
          publishedAt: toIso(publishedRaw),
          summary: (it.contentSnippet || it.summary || "").toString().slice(0, 240) || null,
          _fallbackGenre: f.defaultGenre,
        });
      }
    })
  );

  allItems.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));

  const genres = {};
  for (const it of allItems) {
    const g = pickGenre({ title: it.title, source: it.source, fallback: it._fallbackGenre });
    if (!genres[g]) genres[g] = [];
    const { _fallbackGenre, ...clean } = it;
    genres[g].push(clean);
  }

  // キャッシュヒント（Vercel/CDN側で軽く効かせる。完全保存はしない）
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ generatedAt: new Date().toISOString(), hours, genres });
}