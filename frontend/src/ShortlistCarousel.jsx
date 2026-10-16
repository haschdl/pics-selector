import { useEffect, useMemo, useState } from "react";
import { largeUrl, thumbUrl } from "./api.js";

const CAROUSEL_CSS = `
.short-carousel { display: grid; gap: 14px; min-height: 0; }
.short-carousel-main { display: grid; grid-template-columns: 52px minmax(0, 1fr) 52px; gap: 12px; align-items: stretch; min-height: min(62vh, 680px); }
.carousel-photo-wrap { min-width: 0; min-height: 0; background: var(--well); display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.carousel-photo { width: 100%; height: 100%; min-height: 0; object-fit: contain; display: block; }
.carousel-caption { display: flex; justify-content: space-between; gap: 16px; padding: 10px 14px; background: var(--film); color: var(--paper); font-family: var(--type-file); font-size: 12px; }
.carousel-count { color: var(--brass); }
.carousel-arrow { border: 1px solid var(--ink); background: transparent; color: var(--ink); font-family: var(--type-file); font-size: 24px; }
.carousel-arrow:hover:not(:disabled) { background: var(--well); color: var(--paper); }
.carousel-arrow:disabled { opacity: .25; cursor: default; }
.carousel-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.carousel-actions .act { min-width: 170px; }
.carousel-thumbs { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-color: var(--brass) transparent; }
.carousel-thumb { flex: 0 0 auto; border: 0; padding: 0; background: transparent; color: var(--ink); display: grid; gap: 4px; text-align: left; opacity: 1; }
.carousel-thumb img { width: 108px; height: 74px; object-fit: cover; display: block; outline: 2px solid transparent; outline-offset: 2px; }
.carousel-thumb span { font-family: var(--type-file); font-size: 9px; letter-spacing: .08em; }
.carousel-thumb.is-current img { outline-color: var(--paper); }
.carousel-thumb.is-cut { opacity: .35; }
.carousel-thumb.is-cut img { filter: grayscale(1); }
@media (max-width: 820px) {
  .short-carousel-main { grid-template-columns: 38px minmax(0, 1fr) 38px; min-height: 52vh; gap: 6px; }
  .carousel-arrow { font-size: 18px; }
  .carousel-thumb img { width: 86px; height: 62px; }
}
`;

export default function ShortlistCarousel({ picked, keepers, onToggle }) {
  const [index, setIndex] = useState(0);
  const keeperSet = useMemo(() => new Set(keepers), [keepers]);
  const safeIndex = Math.max(0, Math.min(picked.length - 1, index));
  const current = picked[safeIndex];

  useEffect(() => {
    if (!current) return;
    const currentIndex = picked.indexOf(current);
    const start = Math.max(0, currentIndex - 2);
    const end = Math.min(picked.length, currentIndex + 6);
    for (let i = start; i < end; i += 1) {
      if (i === currentIndex) continue;
      const image = new Image();
      image.decoding = "async";
      image.src = largeUrl(picked[i]);
    }
  }, [current, picked]);

  useEffect(() => {
    function onKey(event) {
      const el = event.target;
      if (el instanceof HTMLElement && el.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((value) => Math.min(picked.length - 1, value + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === "Enter" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (current) onToggle(current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onToggle, picked.length]);

  if (!current) return null;

  const kept = keeperSet.has(current);

  return (
    <div className="short-carousel">
      <style>{CAROUSEL_CSS}</style>
      <div className="short-carousel-main">
        <button
          type="button"
          className="carousel-arrow carousel-arrow-prev"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={safeIndex === 0}
          aria-label="Previous shortlisted photo"
        >
          ←
        </button>
        <div className="carousel-photo-wrap">
          <img className="carousel-photo" src={largeUrl(current)} alt={current} />
          <div className="carousel-caption">
            <span className="carousel-name">{current}</span>
            <span className="carousel-count">{safeIndex + 1} / {picked.length}</span>
          </div>
        </div>
        <button
          type="button"
          className="carousel-arrow carousel-arrow-next"
          onClick={() => setIndex((value) => Math.min(picked.length - 1, value + 1))}
          disabled={safeIndex === picked.length - 1}
          aria-label="Next shortlisted photo"
        >
          →
        </button>
      </div>

      <div className="carousel-actions">
        <button
          type="button"
          className={kept ? "act act-keep is-on" : "act act-keep"}
          onClick={() => onToggle(current)}
        >
          {kept ? "Cut this photo" : "Restore this photo"}
        </button>
        <span className="wall-help">← → browse · K toggle keep/cut</span>
      </div>

      <div className="carousel-thumbs" role="list" aria-label="Shortlisted photos">
        {picked.map((name, thumbIndex) => {
          const isCurrent = thumbIndex === safeIndex;
          const isKept = keeperSet.has(name);
          return (
            <button
              key={name}
              type="button"
              role="listitem"
              className={`carousel-thumb ${isCurrent ? "is-current" : ""} ${isKept ? "" : "is-cut"}`}
              onClick={() => setIndex(thumbIndex)}
              title={name}
            >
              <img src={thumbUrl(name)} alt="" />
              <span>{name.replace("IMG_", "").replace(".jpg", "")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
