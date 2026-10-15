import { useEffect, useMemo, useRef, useState } from "react";
import BurstStudio from "./BurstStudio.jsx";
import ShortlistWall from "./ShortlistWall.jsx";
import EmailDraft from "./EmailDraft.jsx";
import {
  burstStatus,
  getCatalog,
  getSession,
  pickedFromDecisions,
  saveSession,
  syncKeepers,
} from "./api.js";

const USERS = [
  ["half", "Half"],
  ["karolina", "Karolina"],
];

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [session, setSession] = useState(null);
  const [user, setUser] = useState("half");
  const [error, setError] = useState("");
  const saveTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getCatalog()
      .then((cat) => {
        if (!cancelled) setCatalog(cat);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setSession(null);
    getSession(user)
      .then((ses) => {
        if (cancelled) return;
        const keepers = syncKeepers(ses.keepers, pickedFromDecisions(ses.decisions));
        setSession({ ...ses, keepers });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!session) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveSession(session, user).catch(() => {});
    }, 180);
    return () => clearTimeout(saveTimer.current);
  }, [session, user]);

  const stats = useMemo(() => {
    if (!catalog || !session) return null;
    const reviewed = catalog.bursts.filter(
      (burst) => burstStatus(session.decisions[burst.id]) !== "open",
    ).length;
    const picked = pickedFromDecisions(session.decisions);
    return {
      reviewed,
      bursts: catalog.bursts.length,
      picked: picked.length,
      kept: session.keepers.length,
    };
  }, [catalog, session]);

  function updateSession(patch) {
    setSession((prev) => ({ ...prev, ...patch }));
  }

  function decide(burst, patch, extras = {}) {
    setSession((prev) => {
      const decisions = {
        ...prev.decisions,
        [burst.id]: {
          picks: prev.decisions[burst.id]?.picks || [],
          skipped: false,
          ...patch,
        },
      };
      return {
        ...prev,
        ...extras,
        decisions,
        keepers: syncKeepers(prev.keepers, pickedFromDecisions(decisions)),
      };
    });
  }

  if (error) {
    return (
      <div className="boot">
        <p className="boot-title">The proofs did not load.</p>
        <p className="boot-copy">{error}</p>
      </div>
    );
  }

  if (!catalog || !session || !stats) {
    return (
      <div className="boot">
        <p className="boot-title">Laying out the contact sheet…</p>
        <p className="boot-copy">351 proofs, grouped into camera bursts.</p>
      </div>
    );
  }

  const over = session.keepers.length > session.target;
  const stage = session.stage;

  return (
    <div className="app">
      <header className="mast">
        <div className="mast-brand">
          <p className="mast-mark">Keepers</p>
          <p className="mast-sub">Vanessa Dias · proofs</p>
          <div className="user-switch" aria-label="Selection owner">
            {USERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={user === id ? "user-btn is-on" : "user-btn"}
                onClick={() => {
                  if (id === user) return;
                  clearTimeout(saveTimer.current);
                  setUser(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="mast-count">
          <span className="mast-num">{stats.reviewed}</span>
          <span className="mast-of">/{stats.bursts} poses</span>
          <span className="mast-sep"> · </span>
          <span className="mast-num">{stats.kept}</span>
          <span className="mast-of"> kept</span>
          <span className="mast-of"> · target {session.target}</span>
        </p>
        <nav className="mast-nav" aria-label="Stages">
          {[
            ["strip", "Strip"],
            ["shortlist", "Shortlist"],
            ["email", "Email"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={stage === id ? "nav-link is-on" : "nav-link"}
              onClick={() => updateSession({ stage: id })}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {over && stage !== "strip" ? (
        <p className="over-banner">
          {session.keepers.length - session.target} over the {session.target}{" "}
          target. Cut on the shortlist before sending.
        </p>
      ) : null}

      {stage === "strip" ? (
        <BurstStudio
          catalog={catalog}
          session={session}
          onSession={updateSession}
          onDecide={decide}
        />
      ) : null}
      {stage === "shortlist" ? (
        <ShortlistWall session={session} onSession={updateSession} />
      ) : null}
      {stage === "email" ? (
        <EmailDraft session={session} onSession={updateSession} over={over} />
      ) : null}
    </div>
  );
}
