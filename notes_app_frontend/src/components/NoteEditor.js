import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const { state, derived, actions } = useNotes();
  const note = derived.selectedNote;

  const debounceRef = useRef(null);
  const baselineRef = useRef({ noteId: null, snapshot: null });
  const pendingSelectionRef = useRef(null);

  const [draft, setDraft] = useState({
    title: "",
    category: "General",
    content: "",
    isFavorite: false,
  });

  const canEdit = Boolean(note?.id);
  const isDirty = Boolean(derived.editor?.dirty);
  const isSaving = Boolean(derived.editor?.saving);

  // Establish/refresh baseline when selection changes.
  useEffect(() => {
    // Clear any pending autosave on note switch.
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;

    if (!note) {
      baselineRef.current = { noteId: null, snapshot: null };
      actions.setEditorDirty(false);
      actions.setEditorSaving(false);
      setDraft({ title: "", category: "General", content: "", isFavorite: false });
      return;
    }

    const nextDraft = {
      title: note.title || "",
      category: note.category || "General",
      content: note.content || "",
      isFavorite: Boolean(note.isFavorite),
    };

    baselineRef.current = { noteId: note.id, snapshot: nextDraft };
    actions.setEditorDirty(false);
    actions.setEditorSaving(false);
    setDraft(nextDraft);
  }, [note?.id]); // only when selecting a new note

  // Guard: if user tries to switch selection while dirty, confirm and either allow or revert.
  useEffect(() => {
    const currentId = note?.id || null;
    if (!currentId) {
      pendingSelectionRef.current = null;
      return;
    }
    if (!isDirty) {
      pendingSelectionRef.current = null;
      return;
    }

    // If selection changed externally while dirty, prompt immediately.
    // We detect by comparing to baselineRef noteId; if it differs, we know a selection switch happened.
    const baselineId = baselineRef.current.noteId;
    if (baselineId && baselineId !== currentId) {
      // eslint-disable-next-line no-alert
      const ok = window.confirm("You have unsaved changes. Discard them and switch notes?");
      if (ok) {
        // Accept new selection: baseline will reset in selection effect.
        actions.setEditorDirty(false);
        pendingSelectionRef.current = null;
      } else {
        // Revert selection back to baseline note id.
        pendingSelectionRef.current = baselineId;
        actions.selectNote(baselineId);
      }
    }
  }, [state.selectedNoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard: browser navigation/refresh when dirty
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      // Chrome requires returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

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

  const scheduleAutosave = (nextDraft) => {
    if (!note?.id) return;

    const baseline = baselineRef.current.snapshot;
    const sameAsBaseline =
      baseline &&
      baseline.title === nextDraft.title &&
      baseline.category === nextDraft.category &&
      baseline.content === nextDraft.content &&
      baseline.isFavorite === nextDraft.isFavorite;

    actions.setEditorDirty(!sameAsBaseline);

    if (sameAsBaseline) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
      actions.setEditorSaving(false);
      return;
    }

    // Debounced autosave to avoid excessive writes.
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    actions.setEditorSaving(true);

    debounceRef.current = window.setTimeout(() => {
      actions.updateNote(note.id, {
        title: nextDraft.title || "Untitled",
        category: nextDraft.category || "General",
        content: nextDraft.content || "",
        isFavorite: Boolean(nextDraft.isFavorite),
      });

      // After store update, treat the just-saved draft as baseline.
      baselineRef.current = { noteId: note.id, snapshot: { ...nextDraft } };
      actions.markEditorSaved();
      debounceRef.current = null;
    }, 650);
  };

  const onDelete = () => {
    if (!note) return;
    // Slightly safer confirm (undo exists, but confirm avoids accidental deletes).
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete "${note.title || "Untitled"}"? You can undo this deletion while the app is open.`);
    if (!ok) return;
    actions.setEditorDirty(false);
    actions.deleteNote(note.id);
  };

  return (
    <section className={`${styles.card} ocean-surface`} aria-label="Note editor">
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.hTitle}>
            Detail{" "}
            {note && isDirty ? (
              <span className={styles.dirty} aria-label="Unsaved changes indicator" title="Unsaved changes">
                • Unsaved
              </span>
            ) : null}
          </div>
          <div className="ocean-muted" style={{ fontSize: 12 }}>
            {note ? "Autosaves after you pause typing" : "Select a note to begin"}
          </div>
        </div>

        <div className={styles.headerActions}>
          {note ? (
            <div
              className={`${styles.saveBadge} ${isSaving ? styles.saveBadgeActive : ""}`}
              aria-label={isSaving ? "Saving" : isDirty ? "Pending changes" : "Saved"}
              title={isSaving ? "Saving…" : isDirty ? "Pending changes" : "Saved"}
            >
              {isSaving ? "Saving…" : isDirty ? "Pending…" : "Saved"}
            </div>
          ) : null}

          <button
            className={`ocean-btn ${styles.favBtn} ${draft.isFavorite ? styles.favActive : ""}`}
            type="button"
            onClick={() => {
              const next = { ...draft, isFavorite: !draft.isFavorite };
              setDraft(next);
              scheduleAutosave(next);
            }}
            aria-label={draft.isFavorite ? "Unfavorite note" : "Favorite note"}
            disabled={!canEdit}
          >
            ★
          </button>

          <button
            className="ocean-btn ocean-btnDanger"
            type="button"
            onClick={onDelete}
            disabled={!canEdit}
            aria-label="Delete note"
          >
            Delete
          </button>
        </div>
      </div>

      {!note ? (
        <div className={styles.blank} role="status" aria-live="polite">
          <div className={styles.blankTitle}>No note selected</div>
          <div className="ocean-muted">Choose a note from the list, or create a new note from the top bar.</div>
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
                  onChange={(e) => {
                    const next = { ...draft, title: e.target.value };
                    setDraft(next);
                    scheduleAutosave(next);
                  }}
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
                  onChange={(e) => {
                    const next = { ...draft, category: e.target.value };
                    setDraft(next);
                    scheduleAutosave(next);
                  }}
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
                onChange={(e) => {
                  const next = { ...draft, content: e.target.value };
                  setDraft(next);
                  scheduleAutosave(next);
                }}
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
                if (b.type === "h1")
                  return (
                    <h2 key={idx} className={styles.h2}>
                      {b.text}
                    </h2>
                  );
                if (b.type === "h2")
                  return (
                    <h3 key={idx} className={styles.h3}>
                      {b.text}
                    </h3>
                  );
                if (b.type === "h3")
                  return (
                    <h4 key={idx} className={styles.h4}>
                      {b.text}
                    </h4>
                  );
                if (b.type === "li")
                  return (
                    <div key={idx} className={styles.li}>
                      • {b.text}
                    </div>
                  );
                return (
                  <div key={idx} className={styles.p}>
                    {b.text}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
