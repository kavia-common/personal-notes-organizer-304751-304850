import React, { useMemo, useRef } from "react";
import styles from "./TopNav.module.css";
import { useNotes } from "../store/NotesStore";
import { getApiBaseUrl } from "../api/client";

// PUBLIC_INTERFACE
export default function TopNav() {
  /** Top navigation bar with app title and global actions. */
  const { state, derived, actions } = useNotes();
  const apiBase = getApiBaseUrl();

  const stats = useMemo(() => {
    const total = state.notes.length;
    const visible = derived.visibleNotes.length;
    return { total, visible };
  }, [state.notes.length, derived.visibleNotes.length]);

  const importRef = useRef(null);

  return (
    <div className={styles.wrap} role="banner" aria-label="Top navigation">
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">
            N
          </div>
          <div>
            <div className={styles.title}>Ocean Notes</div>
            <div className={styles.sub}>
              <span className="ocean-muted">
                {stats.visible}/{stats.total} notes
              </span>
              <span className={styles.dot} aria-hidden="true" />
              <span className="ocean-muted">
                {apiBase ? `API: ${apiBase}` : "Offline mode"}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <button
            className={`ocean-btn ${styles.newBtn}`}
            onClick={() => actions.createNote({ title: "Untitled", category: "General", content: "" })}
            aria-label="Create a new note"
            type="button"
          >
            <span className={styles.plus} aria-hidden="true">
              +
            </span>
            New note
          </button>

          <button
            className={`ocean-btn ${styles.dupBtn}`}
            type="button"
            onClick={() => state.selectedNoteId && actions.duplicateNote(state.selectedNoteId)}
            aria-label="Duplicate selected note"
            disabled={!state.selectedNoteId}
            title={state.selectedNoteId ? "Duplicate selected note" : "Select a note to duplicate"}
          >
            Duplicate
          </button>

          <button
            className={`ocean-btn ${styles.ioBtn}`}
            type="button"
            onClick={() => actions.exportAllNotes()}
            aria-label="Export notes to JSON"
            title="Export JSON"
          >
            Export
          </button>

          <button
            className={`ocean-btn ${styles.ioBtn}`}
            type="button"
            onClick={() => importRef.current?.click()}
            aria-label="Import notes from JSON"
            title="Import JSON"
          >
            Import
          </button>

          <input
            ref={importRef}
            className={styles.fileInput}
            type="file"
            accept="application/json,.json"
            aria-label="Choose JSON file to import notes"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) actions.importNotesFromFile(file);
              // allow re-importing same file
              e.target.value = "";
            }}
          />

          <div className={styles.hint} aria-label="Keyboard shortcut hint">
            <span className="ocean-muted">Tip:</span> <span className="ocean-kbd">Ctrl</span>+
            <span className="ocean-kbd">K</span> to focus search
          </div>
        </div>
      </div>
    </div>
  );
}
