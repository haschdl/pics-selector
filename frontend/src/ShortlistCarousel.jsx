import { useEffect, useMemo, useState } from "react";
import { largeUrl } from "./api.js";

const CAROUSEL_CSS = `
.wall { display: flex; flex-direction: column; overflow: hidden; padding: 8px 10px 10px; }
.short-carousel { flex: 1 1 0; min-width: 0; min-height: 0; width: 100%; overflow: hidden; display: flex; }
.short-carousel-main { position: relative; flex: 1 1 0; width: 100%; min-width: 0; min-height: 0; height: 100%; background: var(--well); overflow: hidden; }
.carousel-photo-wrap { position: absolute; inset: 0; overflow: hidden; }
.carousel-photo { position: absolute; inset: 0; margin: auto; width: auto; height: auto; max-width: 100%; max-height: 100%; object-fit: contain; object-position: center; display: block; }
.carousel-arrow { position: absolute; z-index: 2; top: 50%; transform: translateY(-50%); width: 42px; height: 64px; border: 0; background: rgba(18,21,22,.38); color: var(--paper); font-size: 28px; backdrop-filter: blur(4px); }
.carousel-arrow-prev { left: 10px; }
.carousel-arrow-next { right: 10px; }
.carousel-arrow:hover:not(:disabled) { background: rgba(18,21,22,.72); }
.carousel-arrow:disabled { opacity: .16; cursor: default; }
.carousel-overlay { position: absolute; z-index: 2; left: 10px; right: 10px; bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 12px; pointer-events: none; }
.carousel-caption { display: flex; gap: 12px; align-items: center; padding: 7px 10px; background: rgba(18,21,22,.62); color: var(--paper); font-family: var(--type-file); font-size: 11px; backdrop-filter: blur(4px); }
.carousel-count { color: var(--brass); }
.carousel-toggle { pointer-events: auto; border: 0; padding: 8px 12px; background: rgba(18,21,22,.68); color: var(--paper); font-family: var(--type-file); font-size: 11px; backdrop-filter: blur(4px); }
.carousel-toggle:hover { background: var(--brass); color: var(--ink); }
.carousel-toggle.is-cut { background: var(--skip); color: #fff; }
@media (max-width: 820px) {
  .wall { padding: 5px 6px 6px; }
  .carousel-arrow { width: 34px; height: 54px; font-size: 22px; }
  .carousel-arrow-prev { left: 6px; }
  .carousel-arrow-next { right: 6px; }
  .carousel-overlay { left: 6px; right: 6px; bottom: 6px; }
  .carousel-caption { font-size: 10px; padding: 6px 8px; }
  .carousel-toggle { font-size: 10px; padding: 7px 9px; }
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
        <div className="carousel-photo-wrap">
          <img className="carousel-photo" src={largeUrl(current)} alt={current} />
        </div>
        <button
          type="button"
          className="carousel-arrow carousel-arrow-prev"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={safeIndex === 0}
          aria-label="Previous shortlisted photo"
        >
          ←
        </button>
        <button
          type="button"
          className="carousel-arrow carousel-arrow-next"
          onClick={() => setIndex((value) => Math.min(picked.length - 1, value + 1))}
          disabled={safeIndex === picked.length - 1}
          aria-label="Next shortlisted photo"
        >
          →
        </button>
        <div className="carousel-overlay">
          <div className="carousel-caption">
            <span>{current}</span>
            <span className="carousel-count">{safeIndex + 1} / {picked.length}</span>
          </div>
          <button
            type="button"
            className={kept ? "carousel-toggle" : "carousel-toggle is-cut"}
            onClick={() => onToggle(current)}
          >
            {kept ? "Cut" : "Restore"}
          </button>
        </div>
      </div>
    </div>
  );
}
