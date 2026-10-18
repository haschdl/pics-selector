import ShortlistCarousel from "./ShortlistCarousel.jsx";
import { pickedFromDecisions } from "./api.js";

const MINIMAL_SHORTLIST_CSS = `
.mast { grid-template-columns: auto 1fr; align-items: center; gap: 14px; padding: 7px 14px; }
.mast-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mast-mark { margin: 0; font-size: 22px; line-height: 1; }
.mast-sub, .mast-count { display: none; }
.mast .user-switch { margin: 0; }
.mast .user-btn { padding-top: 3px; padding-bottom: 3px; }
.mast-nav { justify-self: end; gap: 12px; }
.nav-link { padding-bottom: 2px; }
.over-banner { display: none; }
@media (max-width: 820px) {
  .mast { padding: 5px 8px; gap: 8px; }
  .mast-mark { font-size: 19px; }
  .mast-brand { gap: 7px; }
  .mast-nav { gap: 8px; }
  .nav-link { font-size: 10px; }
  .mast .user-btn { padding: 2px 5px; font-size: 10px; }
}
`;

export default function ShortlistWall({ session, onSession }) {
  const picked = pickedFromDecisions(session.decisions);
  const keepers = session.keepers || [];
  const keeperSet = new Set(keepers);

  function toggle(name) {
    const next = keeperSet.has(name)
      ? keepers.filter((item) => item !== name)
      : [...keepers, name];
    onSession({ keepers: next });
  }

  if (picked.length === 0) {
    return (
      <section className="wall">
        <div className="wall-empty">
          <p className="boot-title">The wall is empty.</p>
          <p className="boot-copy">Keep a frame on the strip first.</p>
          <button
            type="button"
            className="act act-keep"
            onClick={() => onSession({ stage: "strip" })}
          >
            Back to the strip
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="wall">
      <style>{MINIMAL_SHORTLIST_CSS}</style>
      <ShortlistCarousel picked={picked} keepers={keepers} onToggle={toggle} />
    </section>
  );
}
