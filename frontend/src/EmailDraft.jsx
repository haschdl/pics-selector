import { useState } from "react";
import { thumbUrl } from "./api.js";

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function plainList(session) {
  const lines = session.keepers.map((name, i) => `${i + 1}. ${name}`);
  return `${session.greeting}\n\n${lines.join("\n")}\n\n${session.signoff}`;
}

export default function EmailDraft({ session, onSession, over }) {
  const [copied, setCopied] = useState("");
  const keepers = session.keepers || [];

  async function copyText() {
    try {
      await navigator.clipboard.writeText(plainList(session));
      setCopied("text");
    } catch {
      setCopied("");
    }
    setTimeout(() => setCopied(""), 1600);
  }

  async function copyRich() {
    const blocks = await Promise.all(
      keepers.map(async (name, i) => {
        const res = await fetch(thumbUrl(name));
        const dataUrl = await blobToDataUrl(await res.blob());
        return `<tr>
          <td style="padding:10px 14px 10px 0;vertical-align:top;font:14px/1.4 -apple-system,Helvetica,Arial,sans-serif;color:#16181A;">${i + 1}.</td>
          <td style="padding:10px 16px 10px 0;vertical-align:top;">
            <img src="${dataUrl}" alt="${name}" width="160" style="display:block;max-width:160px;height:auto;border:0;" />
          </td>
          <td style="padding:10px 0;vertical-align:top;font:14px/1.4 'IBM Plex Mono',ui-monospace,monospace;color:#16181A;">${name}</td>
        </tr>`;
      }),
    );
    const html = `<div>
      <p style="white-space:pre-wrap;font:16px/1.5 Georgia,serif;color:#16181A;">${escapeHtml(session.greeting)}</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${blocks.join("")}</table>
      <p style="white-space:pre-wrap;font:16px/1.5 Georgia,serif;color:#16181A;">${escapeHtml(session.signoff)}</p>
    </div>`;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainList(session)], { type: "text/plain" }),
        }),
      ]);
      setCopied("rich");
    } catch {
      await copyText();
    }
    setTimeout(() => setCopied(""), 1600);
  }

  async function copyNames() {
    try {
      await navigator.clipboard.writeText(keepers.join("\n"));
      setCopied("names");
    } catch {
      setCopied("");
    }
    setTimeout(() => setCopied(""), 1600);
  }

  if (over) {
    return (
      <section className="mail">
        <div className="wall-empty">
          <p className="boot-title">Still over the target.</p>
          <p className="boot-copy">
            {keepers.length} photos are marked keep, and the target is {session.target}.
            Cut on the shortlist, then come back to copy the letter.
          </p>
          <button
            type="button"
            className="act act-keep"
            onClick={() => onSession({ stage: "shortlist" })}
          >
            Back to the shortlist
          </button>
        </div>
      </section>
    );
  }

  if (keepers.length === 0) {
    return (
      <section className="mail">
        <div className="wall-empty">
          <p className="boot-title">Nothing to send yet.</p>
          <p className="boot-copy">Pin frames on the strip, then trim the wall.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mail">
      <div className="mail-toolbar">
        <button type="button" className="act act-keep" onClick={copyRich}>
          {copied === "rich" ? "Copied for paste" : "Copy for email"}
        </button>
        <button type="button" className="act act-next" onClick={copyText}>
          {copied === "text" ? "Copied" : "Copy as text"}
        </button>
        <button type="button" className="act act-next" onClick={copyNames}>
          {copied === "names" ? "Copied" : "Copy filenames"}
        </button>
        <a className="act act-next" href="/api/contact-sheet" download="keepers-contact-sheet.jpg">
          Download contact sheet
        </a>
      </div>

      <article className="letter" id="email-letter">
        <textarea
          className="letter-edit"
          rows={4}
          value={session.greeting}
          onChange={(e) => onSession({ greeting: e.target.value })}
          aria-label="Email greeting"
        />
        <ol className="letter-list">
          {keepers.map((name) => (
            <li key={name} className="letter-row">
              <img src={thumbUrl(name)} alt="" />
              <span className="letter-name">{name}</span>
            </li>
          ))}
        </ol>
        <textarea
          className="letter-edit"
          rows={3}
          value={session.signoff}
          onChange={(e) => onSession({ signoff: e.target.value })}
          aria-label="Email signoff"
        />
      </article>
    </section>
  );
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "<br>");
}
