import React, { useEffect, useMemo, useState } from "react";

/**
 * Music News 24h App (MVP)
 * 
 * This is a front-end UI that expects a backend endpoint:
 *   GET /api/news?hours=24
 * 
 * Response shape (example):
 * {
 *   generatedAt: "2026-02-23T06:00:00.000Z",
 *   hours: 24,
 *   genres: {
 *     "Techno": [{ title, url, publishedAt, source }],
 *     "Hip-Hop": [...],
 *     "Other": [...]
 *   }
 * }
 */

const DEFAULT_HOURS = 24;

const GENRE_ORDER = [
  "Techno",
  "House",
  "Drum & Bass",
  "Dubstep",
  "UK Garage",
  "Ambient",
  "Experimental",
  "Hip-Hop",
  "Pop",
  "Rock",
  "Metal",
  "Japan",
  "Other",
];

function fmtLocal(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function norm(s) {
  return (s ?? "").toString().trim();
}

export default function MusicNews24hApp() {
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeGenre, setActiveGenre] = useState("Techno");
  const [q, setQ] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);

  const genres = useMemo(() => {
    const g = data?.genres ?? {};
    const keys = Object.keys(g);
    const ordered = [
      ...GENRE_ORDER.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !GENRE_ORDER.includes(k)).sort(),
    ];
    return ordered;
  }, [data]);

  const activeItems = useMemo(() => {
    const items = (data?.genres?.[activeGenre] ?? []).slice();
    const query = norm(q).toLowerCase();
    if (!query) return items;
    return items.filter((it) => {
      const t = norm(it.title).toLowerCase();
      const s = norm(it.source).toLowerCase();
      return t.includes(query) || s.includes(query);
    });
  }, [data, activeGenre, q]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/news?hours=${encodeURIComponent(hours)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      // Pick a sensible default genre when the data changes
      const keys = Object.keys(json?.genres ?? {});
      if (keys.length) {
        const preferred = GENRE_ORDER.find((k) => keys.includes(k)) ?? keys[0];
        setActiveGenre((cur) => (keys.includes(cur) ? cur : preferred));
      }
    } catch (e) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const totalCount = useMemo(() => {
    const g = data?.genres ?? {};
    return Object.values(g).reduce((acc, arr) => acc + (arr?.length ?? 0), 0);
  }, [data]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Music News (Last {hours}h)</h1>
            <p className="text-zinc-400 mt-1">
              {data?.generatedAt ? (
                <>
                  Updated: <span className="text-zinc-300">{fmtLocal(data.generatedAt)}</span> · Total: <span className="text-zinc-300">{totalCount}</span>
                </>
              ) : (
                <>Fetching headlines…</>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-sm text-zinc-300">Window</label>
            <select
              className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {[6, 12, 24, 48].map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>

            <button
              className="bg-zinc-100 text-zinc-950 rounded-xl px-3 py-2 text-sm font-medium hover:opacity-90"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="w-full md:w-96 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm"
              placeholder="Search title / source…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-zinc-300 select-none">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              Hide empty genres
            </label>
          </div>

          {error ? (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded-xl px-3 py-2">Error: {error}</div>
          ) : null}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-12 gap-4">
          <aside className="md:col-span-4 lg:col-span-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3">
              <div className="text-xs uppercase tracking-wider text-zinc-400 px-2 pb-2">Genres</div>
              <div className="flex flex-col gap-1">
                {genres
                  .filter((g) => !hideEmpty || (data?.genres?.[g]?.length ?? 0) > 0)
                  .map((g) => {
                    const count = data?.genres?.[g]?.length ?? 0;
                    const active = g === activeGenre;
                    return (
                      <button
                        key={g}
                        onClick={() => setActiveGenre(g)}
                        className={
                          "flex items-center justify-between rounded-xl px-3 py-2 text-sm border transition " +
                          (active
                            ? "bg-zinc-100 text-zinc-950 border-zinc-100"
                            : "bg-zinc-950/40 text-zinc-100 border-zinc-800 hover:border-zinc-700")
                        }
                      >
                        <span className="font-medium">{g}</span>
                        <span className={active ? "text-zinc-700" : "text-zinc-400"}>{count}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-500">
              Tip: add new feeds + keyword rules in the backend, then this UI will automatically show new genres.
            </div>
          </aside>

          <main className="md:col-span-8 lg:col-span-9">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold">{activeGenre}</div>
                  <div className="text-sm text-zinc-400">{activeItems.length} items</div>
                </div>
              </div>

              <ul className="divide-y divide-zinc-800">
                {activeItems.length === 0 ? (
                  <li className="p-6 text-zinc-400">No items.</li>
                ) : (
                  activeItems.map((it) => (
                    <li key={it.id ?? it.url} className="p-4">
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base font-medium hover:underline"
                      >
                        {it.titleJa ?? it.title}
                      </a>
                      
                      {(it.summaryJa ?? it.summary) ? (
                        <p className="mt-2 text-sm text-zinc-300 leading-relaxed">
                          {it.summaryJa ?? it.summary}
                        </p>
                      ) : null}
                      </div>
                      {it.summary ? (
                        <p className="mt-2 text-sm text-zinc-300 leading-relaxed">{it.summary}</p>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
