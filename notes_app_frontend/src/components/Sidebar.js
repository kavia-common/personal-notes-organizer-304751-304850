import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./Sidebar.module.css";
import { useNotes } from "../store/NotesStore";

function normalizeName(value) {
  return String(value || "").trim();
}

function canManageCategory(name) {
  const n = normalizeName(name);
  return Boolean(n) && n.toLowerCase() !== "all";
}

// PUBLIC_INTERFACE
export default function Sidebar({ onRequestCloseMobile = null }) {
  /** Sidebar with search input and category/favorites filters + minimal category management. */
  const { state, derived, actions } = useNotes();
  const searchRef = useRef(null);

  const lastFocusRef = useRef(null);
  const renameToRef = useRef(null);
  const mergeFromRef = useRef(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");

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

  // Manage focus when opening "dialog-like" panels (rename/merge).
  useEffect(() => {
    if (!renameOpen) return;
    window.setTimeout(() => renameToRef.current?.focus(), 0);
  }, [renameOpen]);

  useEffect(() => {
    if (!mergeOpen) return;
    window.setTimeout(() => mergeFromRef.current?.focus(), 0);
  }, [mergeOpen]);

  // Global escape: close rename/merge panels first (acts like cancel).
  useEffect(() => {
    const anyOpen = renameOpen || mergeOpen;
    if (!anyOpen) return undefined;

    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (renameOpen) setRenameOpen(false);
      if (mergeOpen) setMergeOpen(false);
      // Return focus to whatever triggered the panel (best-effort).
      window.setTimeout(() => lastFocusRef.current?.focus?.(), 0);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renameOpen, mergeOpen]);

  const items = useMemo(() => {
    return ["All", ...derived.categories];
  }, [derived.categories]);

  const categoriesForManagement = useMemo(() => derived.categories, [derived.categories]);

  const hasActiveFilters = Boolean(
    (state.ui.search || "").trim() ||
      (state.ui.category && state.ui.category !== "All") ||
      Boolean(state.ui.favoritesOnly)
  );

  const onClearAll = () => actions.clearFilters();

  const onSubmitRename = (e) => {
    e.preventDefault();
    const from = normalizeName(renameFrom);
    const to = normalizeName(renameTo);
    if (!canManageCategory(from) || !to) return;
    actions.renameCategory(from, to);
    setRenameOpen(false);
    setRenameFrom("");
    setRenameTo("");
    window.setTimeout(() => lastFocusRef.current?.focus?.(), 0);
  };

  const onSubmitMerge = (e) => {
    e.preventDefault();
    const from = normalizeName(mergeFrom);
    const into = normalizeName(mergeInto);
    if (!canManageCategory(from) || !canManageCategory(into) || from.toLowerCase() === into.toLowerCase()) return;
    actions.mergeCategories(from, into);
    setMergeOpen(false);
    setMergeFrom("");
    setMergeInto("");
    window.setTimeout(() => lastFocusRef.current?.focus?.(), 0);
  };

  const closeMobileIfRequested = () => {
    if (typeof onRequestCloseMobile === "function") onRequestCloseMobile();
  };

  return (
    <aside className={`${styles.card} ocean-surface`} aria-label="Sidebar filters">
      <div className={styles.header}>
        <div>
          <div className={styles.hTitle}>Filters</div>
          <div className="ocean-muted" style={{ fontSize: 12 }}>
            Search, favorites & categories
          </div>
        </div>

        <button
          className={`${styles.clear} ${!hasActiveFilters ? styles.clearDisabled : ""}`}
          onClick={onClearAll}
          aria-label="Clear all active filters"
          type="button"
          disabled={!hasActiveFilters}
          title={hasActiveFilters ? "Clear filters" : "No filters to clear"}
        >
          Clear
        </button>
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

      <div className={styles.section} aria-label="Favorites filters">
        <div className={styles.labelRow}>
          <div className={styles.label}>Favorites</div>
        </div>

        <div className={styles.toggleRow}>
          <button
            type="button"
            className={`${styles.toggleBtn} ${state.ui.favoritesOnly ? styles.toggleActive : ""}`}
            onClick={() => actions.setFavoritesOnly(!state.ui.favoritesOnly)}
            aria-pressed={state.ui.favoritesOnly}
            aria-label="Toggle favorites-only filter"
            title="Show favorites only"
          >
            ★ Favorites only
          </button>

          <button
            type="button"
            className={`${styles.toggleBtn} ${state.ui.favoritesFirst ? styles.toggleActive : ""}`}
            onClick={() => actions.setFavoritesFirst(!state.ui.favoritesFirst)}
            aria-pressed={state.ui.favoritesFirst}
            aria-label="Toggle favorites-first ordering"
            title="Order favorites first"
          >
            ⇧ Favorites first
          </button>
        </div>
      </div>

      <div className={styles.section} aria-label="Category filters">
        <div className={styles.labelRow}>
          <div className={styles.label}>Categories</div>
          <button
            className={styles.clear}
            onClick={() => actions.setCategory("All")}
            aria-label="Reset category filter"
            type="button"
            title="Reset category"
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
                onClick={() => {
                  actions.setCategory(c);
                  closeMobileIfRequested();
                }}
                aria-pressed={active}
                aria-label={`Filter by category ${c}`}
              >
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.catName}>{c}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.manageRow} aria-label="Category management">
          <button
            type="button"
            className={styles.manageBtn}
            onClick={(e) => {
              lastFocusRef.current = e.currentTarget;
              setMergeOpen(false);
              setRenameOpen((v) => !v);
              setRenameFrom(state.ui.category !== "All" ? state.ui.category : "");
              setRenameTo("");
            }}
            aria-expanded={renameOpen}
            aria-controls="category-rename-panel"
            disabled={categoriesForManagement.length === 0}
            title="Rename category"
          >
            Rename
          </button>
          <button
            type="button"
            className={styles.manageBtn}
            onClick={(e) => {
              lastFocusRef.current = e.currentTarget;
              setRenameOpen(false);
              setMergeOpen((v) => !v);
              setMergeFrom(state.ui.category !== "All" ? state.ui.category : "");
              setMergeInto("");
            }}
            aria-expanded={mergeOpen}
            aria-controls="category-merge-panel"
            disabled={categoriesForManagement.length < 2}
            title="Merge categories"
          >
            Merge
          </button>
        </div>

        {renameOpen ? (
          <form
            id="category-rename-panel"
            className={styles.managePanel}
            onSubmit={onSubmitRename}
            role="dialog"
            aria-label="Rename category"
          >
            <div className={styles.manageTitle}>Rename category</div>
            <div className={styles.manageGrid}>
              <label className={styles.srOnly} htmlFor="rename-from">
                From
              </label>
              <select
                id="rename-from"
                className={styles.select}
                value={renameFrom}
                onChange={(e) => setRenameFrom(e.target.value)}
                aria-label="Category to rename"
              >
                <option value="">Select category…</option>
                {categoriesForManagement.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <label className={styles.srOnly} htmlFor="rename-to">
                To
              </label>
              <input
                id="rename-to"
                ref={renameToRef}
                className={styles.inputSmall}
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                placeholder="New name"
                aria-label="New category name"
              />
            </div>

            <div className={styles.manageActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  setRenameOpen(false);
                  window.setTimeout(() => lastFocusRef.current?.focus?.(), 0);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`ocean-btn ocean-btnPrimary ${styles.primarySmall}`}
                disabled={!canManageCategory(renameFrom) || !normalizeName(renameTo)}
              >
                Apply
              </button>
            </div>
          </form>
        ) : null}

        {mergeOpen ? (
          <form
            id="category-merge-panel"
            className={styles.managePanel}
            onSubmit={onSubmitMerge}
            role="dialog"
            aria-label="Merge categories"
          >
            <div className={styles.manageTitle}>Merge categories</div>
            <div className={styles.manageGrid}>
              <label className={styles.srOnly} htmlFor="merge-from">
                From
              </label>
              <select
                id="merge-from"
                ref={mergeFromRef}
                className={styles.select}
                value={mergeFrom}
                onChange={(e) => setMergeFrom(e.target.value)}
                aria-label="Category to merge"
              >
                <option value="">Merge from…</option>
                {categoriesForManagement.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <label className={styles.srOnly} htmlFor="merge-into">
                Into
              </label>
              <select
                id="merge-into"
                className={styles.select}
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                aria-label="Target category"
              >
                <option value="">Merge into…</option>
                {categoriesForManagement
                  .filter((c) => c.toLowerCase() !== normalizeName(mergeFrom).toLowerCase())
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
            </div>

            <div className={styles.manageActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  setMergeOpen(false);
                  window.setTimeout(() => lastFocusRef.current?.focus?.(), 0);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`ocean-btn ocean-btnPrimary ${styles.primarySmall}`}
                disabled={
                  !canManageCategory(mergeFrom) ||
                  !canManageCategory(mergeInto) ||
                  normalizeName(mergeFrom).toLowerCase() === normalizeName(mergeInto).toLowerCase()
                }
              >
                Merge
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </aside>
  );
}
