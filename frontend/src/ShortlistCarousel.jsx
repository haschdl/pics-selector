import { useEffect, useMemo, useState } from "react";
import { largeUrl, thumbUrl } from "./api.js";

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
          {kept ? "Keep this photo" : "Restore this photo"}
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
