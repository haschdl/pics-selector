import { useEffect, useMemo, useRef, useState } from "react";
import { burstStatus, largeUrl, thumbUrl } from "./api.js";

const MAX_PICKS = 2;

export default function BurstStudio({ catalog, session, onSession, onDecide }) {
  const burst = catalog.bursts[session.burstIndex] || catalog.bursts[0];
  const decision = session.decisions[burst.id] || { picks: [], skipped: false };
  const picks = decision.picks || [];
  const [current, setCurrent] = useState(burst.filenames[0]);
  const frame = burst.filenames.includes(current) ? current : burst.filenames[0];
  const stripRef = useRef(null);

  useEffect(() => {
    const strip = stripRef.current;
    const node = strip?.querySelector(`[data-file="${frame}"]`);
    if (!strip || !node) return;
    const nodeRect = node.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    strip.scrollTo({
      left:
        strip.scrollLeft +
        nodeRect.left -
        stripRect.left -
        stripRect.width / 2 +
        nodeRect.width / 2,
      behavior: "smooth",
    });
  }, [frame]);

  const photo = useMemo(
    () => catalog.photos.find((item) => item.filename === frame),
    [catalog.photos, frame],
  );

  function goBurst(index) {
    const next = Math.max(0, Math.min(catalog.bursts.length - 1, index));
    onSession({ burstIndex: next });
  }

  function toggleKeep(name = frame) {
    if (picks.includes(name)) {
      onDecide(burst, { picks: picks.filter((item) => item !== name), skipped: false });
      return;
    }
    if (picks.length >= MAX_PICKS) return;
    onDecide(burst, { picks: [...picks, name], skipped: false });
  }

  function afterPose() {
    if (session.burstIndex >= catalog.bursts.length - 1) {
      return { stage: "shortlist" };
    }
    return { burstIndex: session.burstIndex + 1 };
  }

  function skipPose() {
    onDecide(burst, { picks: [], skipped: true }, afterPose());
  }

  function nextPose() {
    const extras = afterPose();
    if (!decision.skipped && picks.length === 0) {
      onDecide(burst, { picks: [], skipped: true }, extras);
      return;
    }
    onSession(extras);
  }

  useEffect(() => {
    function onKey(event) {
      const el = event.target;
      if (el instanceof HTMLElement && el.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowRight" && event.shiftKey) {
        event.preventDefault();
        goBurst(session.burstIndex + 1);
        return;
      }
      if (event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        goBurst(session.burstIndex - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const i = burst.filenames.indexOf(frame);
        setCurrent(burst.filenames[Math.min(burst.filenames.length - 1, i + 1)]);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const i = burst.filenames.indexOf(frame);
        setCurrent(burst.filenames[Math.max(0, i - 1)]);
      } else if (event.key === "Enter" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleKeep();
      } else if (event.key.toLowerCase() === "x") {
        event.preventDefault();
        skipPose();
      } else if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        nextPose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const frameNo = frame.replace("IMG_", "").replace(".jpg", "");
  const keptHere = picks.length;
  const atCap = keptHere >= MAX_PICKS && !picks.includes(frame);

  return (
    <section className="studio">
      <div className="pose-rail" role="list">
        {catalog.bursts.map((item, index) => {
          const status = burstStatus(session.decisions[item.id]);
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              title={`Pose ${index + 1} · ${item.size} frames`}
              className={`pose-tick is-${status} ${index === session.burstIndex ? "is-now" : ""}`}
              onClick={() => goBurst(index)}
            />
          );
        })}
      </div>

      <div className="studio-meta">
        <p className="file-chip">{frame}</p>
        <p className="studio-kicker">
          Pose {session.burstIndex + 1} of {catalog.bursts.length}
          <span className="meta-gap">·</span>
          {burst.size} frames
          <span className="meta-gap">·</span>
          {photo?.orientation}
          <span className="meta-gap">·</span>
          {keptHere} of {MAX_PICKS} kept
        </p>
      </div>

      <div className="enlarger-row">
        <div className="enlarger">
          <span className="enlarger-edge">
            {frameNo}
            <i />
            {photo ? `${photo.width}×${photo.height}` : ""}
          </span>
          <img key={frame} src={largeUrl(frame)} alt={frame} className="enlarger-img" />
        </div>
        <aside className="studio-actions">
          <button
            type="button"
            className={picks.includes(frame) ? "act act-keep is-on" : "act act-keep"}
            onClick={() => toggleKeep()}
            disabled={atCap}
          >
            {picks.includes(frame) ? "Unpin this frame" : "Keep this frame"}
          </button>
          <button type="button" className="act act-skip" onClick={skipPose}>
            Skip this pose
          </button>
          <button type="button" className="act act-next" onClick={nextPose}>
            {session.burstIndex === catalog.bursts.length - 1
              ? "Go to shortlist"
              : "Next pose"}
          </button>
          <p className="key-hint">
            ← → frames
            <br />
            Shift ← → poses
            <br />
            K keep · X skip · N next
          </p>
          {atCap ? (
            <p className="cap-hint">Two frames already kept in this pose. Unpin one to swap.</p>
          ) : null}
        </aside>
      </div>

      <div className="strip-wrap">
        <div className="strip" ref={stripRef}>
          <span className="sprocket" aria-hidden="true" />
          {burst.filenames.map((name) => {
            const kept = picks.includes(name);
            const on = name === frame;
            const n = name.replace("IMG_", "").replace(".jpg", "");
            return (
              <button
                key={name}
                type="button"
                data-file={name}
                className={`frame ${on ? "is-current" : ""} ${kept ? "is-kept" : ""}`}
                onClick={() => setCurrent(name)}
                onDoubleClick={() => toggleKeep(name)}
              >
                <img src={thumbUrl(name)} alt="" />
                <span className="frame-no">{n}</span>
              </button>
            );
          })}
          <span className="sprocket" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
