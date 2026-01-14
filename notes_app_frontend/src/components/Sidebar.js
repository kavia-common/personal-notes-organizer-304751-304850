import React, { useEffect, useMemo, useRef } from "react";
import styles from "./Sidebar.module.css";
import { useNotes } from "../store/NotesStore";

// PUBLIC_INTERFACE
export default function Sidebar() {
  /** Sidebar with search input and category filters. */
  const { state, derived, actions } = useNotes();
  const searchRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      const isCmdK = (e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K");
      if (isCmdK) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const items = useMemo(() => {
    return ["All", ...derived.categories];
  }, [derived.categories]);

  return (
    <aside className={`${styles.card} ocean-surface`} aria-label="Sidebar filters">
      <div className={styles.header}>
        <div>
          <div className={styles.hTitle}>Filters</div>
          <div className="ocean-muted" style={{ fontSize: 12 }}>
            Search & categories
          </div>
        </div>
      </div>

      <div className={styles.section} aria-label="Search notes">
        <label className={styles.label} htmlFor="note-search">
          Search
        </label>
        <input
          id="note-search"
          ref={searchRef}
          className="ocean-input"
          placeholder="Search title, content, category…"
          value={state.ui.search}
          onChange={(e) => actions.setSearch(e.target.value)}
          aria-label="Search notes"
        />
      </div>

      <div className={styles.section} aria-label="Category filters">
        <div className={styles.labelRow}>
          <div className={styles.label}>Categories</div>
          <button
            className={styles.clear}
            onClick={() => actions.setCategory("All")}
            aria-label="Clear category filter"
            type="button"
          >
            Reset
          </button>
        </div>

        <div className={styles.catList} role="list">
          {items.map((c) => {
            const active = state.ui.category === c;
            return (
              <button
                key={c}
                type="button"
                role="listitem"
                className={`${styles.catItem} ${active ? styles.active : ""}`}
                onClick={() => actions.setCategory(c)}
                aria-pressed={active}
                aria-label={`Filter by category ${c}`}
              >
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.catName}>{c}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
