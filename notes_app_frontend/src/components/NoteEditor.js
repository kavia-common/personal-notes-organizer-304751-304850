import React, { useEffect, useMemo, useState } from "react";
import styles from "./NoteEditor.module.css";
import { useNotes } from "../store/NotesStore";

function snippet(text) {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length > 160 ? `${t.slice(0, 160)}…` : t;
}

// PUBLIC_INTERFACE
export default function NoteEditor() {
  /** Detail view for creating/editing selected note. */
  const { derived, actions } = useNotes();
  const note = derived.selectedNote;

  const [draft, setDraft] = useState({
    title: "",
    category: "General",
    content: "",
    isFavorite: false,
  });

  useEffect(() => {
    if (!note) {
      setDraft({ title: "", category: "General", content: "", isFavorite: false });
      return;
    }
    setDraft({
      title: note.title || "",
      category: note.category || "General",
      content: note.content || "",
      isFavorite: Boolean(note.isFavorite),
    });
  }, [note?.id]); // only when selecting a new note

  const canEdit = Boolean(note?.id);

  const preview = useMemo(() => {
    // Simple markdown-lite preview: preserve line breaks and show basic headings
    const raw = draft.content || "";
    const lines = raw.split("\n");
    return lines
      .map((line) => {
        const m = line.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
          const level = m[1].length;
          return { type: `h${level}`, text: m[2] };
        }
        if (line.trim().startsWith("- ")) return { type: "li", text: line.trim().slice(2) };
        return { type: "p", text: line };
      })
      .slice(0, 80);
  }, [draft.content]);

  const onSave = () => {
    if (!note) return;
    actions.updateNote(note.id, {
      title: draft.title || "Untitled",
      category: draft.category || "General",
      content: draft.content || "",
      isFavorite: Boolean(draft.isFavorite),
    });
  };

  const onDelete = () => {
    if (!note) return;
    // simple confirm to prevent accidental deletion
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete "${note.title || "Untitled"}"? This cannot be undone.`);
    if (!ok) return;
    actions.deleteNote(note.id);
  };

  return (
    <section className={`${styles.card} ocean-surface`} aria-label="Note editor">
      <div className={styles.header}>
        <div>
          <div className={styles.hTitle}>Detail</div>
          <div className="ocean-muted" style={{ fontSize: 12 }}>
            {note ? "Edit your note" : "Select a note to begin"}
          </div>
        </div>

        <div className={styles.headerActions}>
          <button
            className={`ocean-btn ${styles.favBtn} ${draft.isFavorite ? styles.favActive : ""}`}
            type="button"
            onClick={() => setDraft((d) => ({ ...d, isFavorite: !d.isFavorite }))}
            aria-label={draft.isFavorite ? "Unfavorite note" : "Favorite note"}
            disabled={!canEdit}
          >
            ★
          </button>

          <button className="ocean-btn ocean-btnPrimary" type="button" onClick={onSave} disabled={!canEdit} aria-label="Save note">
            Save
          </button>
          <button className="ocean-btn ocean-btnDanger" type="button" onClick={onDelete} disabled={!canEdit} aria-label="Delete note">
            Delete
          </button>
        </div>
      </div>

      {!note ? (
        <div className={styles.blank} role="status" aria-live="polite">
          <div className={styles.blankTitle}>No note selected</div>
          <div className="ocean-muted">
            Choose a note from the list, or create a new note from the top bar.
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.form} aria-label="Editor form">
            <div className={styles.row}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="note-title">
                  Title
                </label>
                <input
                  id="note-title"
                  className="ocean-input"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="Untitled"
                  aria-label="Note title"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="note-category">
                  Category
                </label>
                <input
                  id="note-category"
                  className="ocean-input"
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  placeholder="General"
                  aria-label="Note category"
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="note-content">
                Content (Markdown-lite)
              </label>
              <textarea
                id="note-content"
                className={styles.textarea}
                value={draft.content}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                placeholder={"# Heading\n\n- List item\n\nWrite your note here…"}
                aria-label="Note content"
              />
              <div className={styles.helper}>
                <span className="ocean-muted">Preview updates instantly.</span>
                <span className="ocean-muted">Snippet: “{snippet(draft.content)}”</span>
              </div>
            </div>
          </div>

          <div className={styles.preview} aria-label="Preview">
            <div className={styles.previewHeader}>
              <div className={styles.previewTitle}>Preview</div>
              <div className="ocean-muted" style={{ fontSize: 12 }}>
                Markdown-lite
              </div>
            </div>

            <div className={styles.previewBody}>
              {preview.map((b, idx) => {
                if (b.type === "h1") return <h2 key={idx} className={styles.h2}>{b.text}</h2>;
                if (b.type === "h2") return <h3 key={idx} className={styles.h3}>{b.text}</h3>;
                if (b.type === "h3") return <h4 key={idx} className={styles.h4}>{b.text}</h4>;
                if (b.type === "li") return <div key={idx} className={styles.li}>• {b.text}</div>;
                return <div key={idx} className={styles.p}>{b.text}</div>;
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
