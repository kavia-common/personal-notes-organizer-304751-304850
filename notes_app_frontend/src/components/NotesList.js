import React, { useMemo } from "react";
import styles from "./NotesList.module.css";
import { useNotes } from "../store/NotesStore";

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
  } catch {
    return "";
  }
}

// PUBLIC_INTERFACE
export default function NotesList() {
  /** List of notes, supports sorting, selecting, and quick actions. */
  const { state, derived, actions } = useNotes();

  const selectedId = state.selectedNoteId;

  const sortOptions = useMemo(
    () => [
      { value: "updated_desc", label: "Last updated (newest)" },
      { value: "updated_asc", label: "Last updated (oldest)" },
      { value: "title_asc", label: "Title (A–Z)" },
      { value: "title_desc", label: "Title (Z–A)" },
    ],
    []
  );

  return (
    <section className={`${styles.card} ocean-surface`} aria-label="Notes list">
      <div className={styles.header}>
        <div>
          <div className={styles.hTitle}>Notes</div>
          <div className="ocean-muted" style={{ fontSize: 12 }}>
            {derived.visibleNotes.length} visible
            {state.ui.favoritesOnly ? " • favorites" : ""}
          </div>
        </div>

        <div className={styles.sort}>
          <label className={styles.sortLabel} htmlFor="sort-notes">
            Sort
          </label>
          <select
            id="sort-notes"
            className={styles.select}
            value={state.ui.sort}
            onChange={(e) => actions.setSort(e.target.value)}
            aria-label="Sort notes"
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <label className={styles.check} htmlFor="fav-first">
            <input
              id="fav-first"
              type="checkbox"
              checked={Boolean(state.ui.favoritesFirst)}
              onChange={(e) => actions.setFavoritesFirst(e.target.checked)}
              aria-label="Order favorites first"
            />
            <span>Fav first</span>
          </label>
        </div>
      </div>

      <div className={styles.list} role="list" aria-label="Notes results">
        {derived.visibleNotes.length === 0 ? (
          <div className={styles.empty} role="status" aria-live="polite">
            <div className={styles.emptyTitle}>No notes match your filters.</div>
            <div className="ocean-muted">Try clearing filters or selecting “All”.</div>
          </div>
        ) : (
          derived.visibleNotes.map((n) => {
            const active = n.id === selectedId;
            return (
              <div key={n.id} role="listitem" className={styles.rowWrap}>
                <button
                  type="button"
                  className={`${styles.item} ${active ? styles.active : ""}`}
                  onClick={() => actions.selectNote(n.id)}
                  aria-label={`Open note ${n.title || "Untitled"}`}
                  aria-pressed={active}
                >
                  <div className={styles.itemTop}>
                    <div className={styles.itemTitle}>{n.title || "Untitled"}</div>
                    <div className={styles.date}>{formatDate(n.updatedAt)}</div>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.badge}>{n.category || "General"}</span>
                    {n.isFavorite ? <span className={styles.star} aria-label="Favorite">★</span> : <span />}
                  </div>
                </button>

                <div className={styles.quick} aria-label="Quick actions">
                  <button
                    type="button"
                    className={styles.quickBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.duplicateNote(n.id);
                    }}
                    aria-label={`Duplicate note ${n.title || "Untitled"}`}
                    title="Duplicate"
                  >
                    Duplicate
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
