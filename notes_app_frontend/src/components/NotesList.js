import React, { useEffect, useMemo, useRef } from "react";
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

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// PUBLIC_INTERFACE
export default function NotesList() {
  /** List of notes, supports sorting, selecting, and quick actions. */
  const { state, derived, actions } = useNotes();

  const selectedId = state.selectedNoteId;
  const listboxRef = useRef(null);

  const sortOptions = useMemo(
    () => [
      { value: "updated_desc", label: "Last updated (newest)" },
      { value: "updated_asc", label: "Last updated (oldest)" },
      { value: "title_asc", label: "Title (A–Z)" },
      { value: "title_desc", label: "Title (Z–A)" },
    ],
    []
  );

  // Ensure the active option remains visible when selection changes (mouse/keyboard/other actions).
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(`note-option-${selectedId}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  const onListKeyDown = (e) => {
    const ids = derived.visibleNoteIds || derived.visibleNotes.map((n) => n.id);
    if (!ids.length) return;

    const currentIndex = selectedId ? ids.indexOf(selectedId) : -1;

    const moveToIndex = (nextIndex) => {
      const idx = clamp(nextIndex, 0, ids.length - 1);
      const nextId = ids[idx];
      if (nextId) actions.selectNote(nextId);
    };

    switch (e.key) {
      case "ArrowDown":
      case "Down": {
        e.preventDefault();
        moveToIndex((currentIndex < 0 ? 0 : currentIndex) + 1);
        break;
      }
      case "ArrowUp":
      case "Up": {
        e.preventDefault();
        moveToIndex((currentIndex < 0 ? ids.length - 1 : currentIndex) - 1);
        break;
      }
      case "Home": {
        e.preventDefault();
        moveToIndex(0);
        break;
      }
      case "End": {
        e.preventDefault();
        moveToIndex(ids.length - 1);
        break;
      }
      case "Enter": {
        // Selection already means "open"; keep default button behavior elsewhere.
        // Here, just ensure an item is selected.
        if (!selectedId) {
          e.preventDefault();
          moveToIndex(0);
        }
        break;
      }
      default:
        break;
    }
  };

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

      <div
        ref={listboxRef}
        className={styles.list}
        role="listbox"
        aria-label="Notes results"
        aria-activedescendant={selectedId ? `note-option-${selectedId}` : undefined}
        tabIndex={0}
        onKeyDown={onListKeyDown}
      >
        {derived.visibleNotes.length === 0 ? (
          <div className={styles.empty} role="status" aria-live="polite">
            <div className={styles.emptyTitle}>No notes match your filters.</div>
            <div className="ocean-muted">Try clearing filters or selecting “All”.</div>
          </div>
        ) : (
          derived.visibleNotes.map((n) => {
            const active = n.id === selectedId;
            return (
              <div key={n.id} className={styles.rowWrap}>
                <button
                  id={`note-option-${n.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${styles.item} ${active ? styles.active : ""}`}
                  onClick={() => actions.selectNote(n.id)}
                  aria-label={`Open note ${n.title || "Untitled"}`}
                >
                  <div className={styles.itemTop}>
                    <div className={styles.itemTitle}>{n.title || "Untitled"}</div>
                    <div className={styles.date}>{formatDate(n.updatedAt)}</div>
                  </div>
                  <div className={styles.meta}>
                    <span className={styles.badge}>{n.category || "General"}</span>
                    {n.isFavorite ? (
                      <span className={styles.star} aria-label="Favorite">
                        ★
                      </span>
                    ) : (
                      <span aria-hidden="true" />
                    )}
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
