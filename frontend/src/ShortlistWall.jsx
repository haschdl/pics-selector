import { pickedFromDecisions, thumbUrl } from "./api.js";

export default function ShortlistWall({ session, onSession }) {
  const picked = pickedFromDecisions(session.decisions);
  const keepers = session.keepers || [];
  const keeperSet = new Set(keepers);
  const over = keepers.length > session.target;
  const remaining = session.target - keepers.length;

  function toggle(name) {
    const next = keeperSet.has(name)
      ? keepers.filter((item) => item !== name)
      : [...keepers, name];
    onSession({ keepers: next });
  }

  function restoreAll() {
    onSession({ keepers: picked });
  }

  if (picked.length === 0) {
    return (
      <section className="wall">
        <div className="wall-empty">
          <p className="boot-title">The wall is empty.</p>
          <p className="boot-copy">
            Keep a frame on the strip first. This wall is only the photos you pinned.
          </p>
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
      <div className="wall-bar">
        <p className="wall-meter">
          <span className={over ? "meter-hot" : "meter-ok"}>{keepers.length}</span>
          <span className="mast-of"> / {session.target}</span>
          <span className="wall-note">
            {over
              ? `Cut ${keepers.length - session.target} more`
              : remaining === 0
                ? "On target"
                : `${remaining} seats left`}
          </span>
        </p>
        <div className="target-switch" role="group" aria-label="Keeper target">
          {[20, 40].map((n) => (
            <button
              key={n}
              type="button"
              className={session.target === n ? "target-btn is-on" : "target-btn"}
              onClick={() => onSession({ target: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="wall-help">Click a print to cut it. Click again to bring it back.</p>
        {keepers.length < picked.length ? (
          <button type="button" className="target-btn" onClick={restoreAll}>
            Restore cuts
          </button>
        ) : null}
      </div>
      <div className="wall-grid">
        {picked.map((name) => (
          <button
            key={name}
            type="button"
            className={keeperSet.has(name) ? "print" : "print is-cut"}
            onClick={() => toggle(name)}
          >
            <img src={thumbUrl(name)} alt={name} />
            <span className="print-name">{name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
