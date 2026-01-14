import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { getApiBaseUrl } from "../api/client";
import { SyncService } from "../api/sync";
import {
  buildDemoData,
  buildExportPayload,
  importStateFromJsonText,
  loadFromStorage,
  saveToStorage,
  storageAvailable,
} from "./storage";

/**
 * Performance notes:
 * - Filtering/sorting can be expensive for large note sets.
 * - Persistence writes to localStorage are also expensive and can block the main thread.
 * This file introduces:
 *   1) memoized selectors with narrow dependency keys (so unrelated state changes don't recompute lists)
 *   2) debounced persistence writes (and no writes during initial bootstrap)
 */

function shallowEqualArray(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildNotesSignature(notes) {
  // O(n) signature; still cheaper than repeated filter+sort+map chains on unrelated renders,
  // and stable so we can skip recompute when only runtime UI changed.
  // Includes fields used by list filtering and sorting.
  let out = "";
  for (let i = 0; i < notes.length; i += 1) {
    const n = notes[i];
    out += `${n.id}|${n.updatedAt}|${n.title}|${n.category}|${n.isFavorite ? 1 : 0}|`;
  }
  return out;
}

// PUBLIC_INTERFACE
function createNotesSelectors() {
  /** Creates memoized selector helpers scoped to a store instance. */
  let lastCategoriesSig = null;
  let lastCategories = [];

  let lastVisibleKey = null;
  let lastVisibleNotes = [];
  let lastVisibleIds = [];

  return {
    // PUBLIC_INTERFACE
    getCategories(notes) {
      /** Returns stable categories array when notes category set hasn't changed. */
      const sig = `${notes.length}|` + notes.map((n) => `${n.category || ""}`).join("|");
      if (sig === lastCategoriesSig) return lastCategories;
      lastCategoriesSig = sig;
      lastCategories = deriveCategories(notes);
      return lastCategories;
    },

    // PUBLIC_INTERFACE
    getVisibleNotes(state) {
      /** Returns stable visible notes array when notes/ui inputs haven't changed. */
      const notesSig = buildNotesSignature(state.notes);
      const ui = state.ui;
      const key = `${notesSig}::${ui.category}::${ui.search}::${ui.favoritesOnly ? 1 : 0}::${ui.favoritesFirst ? 1 : 0}::${
        ui.sort
      }`;

      if (key === lastVisibleKey) return lastVisibleNotes;

      lastVisibleKey = key;
      lastVisibleNotes = computeVisibleNotes(state);
      lastVisibleIds = lastVisibleNotes.map((n) => n.id);
      return lastVisibleNotes;
    },

    // PUBLIC_INTERFACE
    getVisibleNoteIds(state) {
      /** Returns stable visible note IDs array when visible notes are unchanged. */
      // Ensure visible notes cache is up to date.
      this.getVisibleNotes(state);
      return lastVisibleIds;
    },
  };
}

/**
 * Formal note schema:
 * {
 *   id: string,
 *   title: string,
 *   category: string,
 *   content: string,
 *   isFavorite: boolean,
 *   createdAt: string (ISO),
 *   updatedAt: string (ISO)
 * }
 */

function nowIso() {
  return new Date().toISOString();
}

/**
 * Deterministic 32-bit FNV-1a hash used to generate stable IDs for new notes.
 * Not cryptographic; only used to reduce collisions and keep IDs repeatable for the same inputs.
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

function normalizeTextForId(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function makeDeterministicNoteId({ title, category, content, createdAt }) {
  const seed = `${normalizeTextForId(title)}\n${normalizeTextForId(category)}\n${normalizeTextForId(content)}\n${String(
    createdAt || ""
  )}`;
  const hash = fnv1a32(seed).toString(16).padStart(8, "0");
  // Add a short timestamp suffix to extremely reduce collisions when a user creates multiple identical notes quickly.
  const suffix = (Date.now() & 0xfffff).toString(16).padStart(5, "0");
  return `note_${hash}_${suffix}`;
}

const DEFAULT_STATE = {
  notes: [],
  selectedNoteId: null,

  // Session-only UI state (not persisted to localStorage to avoid schema coupling)
  uiRuntime: {
    // Editor autosave state
    dirty: false,
    saving: false,
    lastSavedAt: null,
    // Toast/snackbar for undo delete, import errors, etc.
    toast: null, // { id, message, actionLabel?, actionKey? }
  },

  // Session-only undo/trash for delete UX (in-memory)
  trash: {
    // lastDeleted: { note, previousSelectedId, deletedAt }
    lastDeleted: null,
  },

  ui: {
    category: "All",
    search: "",
    favoritesOnly: false,
    favoritesFirst: false,
    sort: "updated_desc", // updated_desc | updated_asc | title_asc | title_desc
  },
};

function isIsoDateString(value) {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function coerceString(value, fallback) {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function normalizeNoteForRuntime(note) {
  if (!note || typeof note !== "object") return null;

  const createdAt = isIsoDateString(note.createdAt) ? note.createdAt : nowIso();
  const updatedAt = isIsoDateString(note.updatedAt) ? note.updatedAt : createdAt;

  const id = typeof note.id === "string" && note.id.trim() ? note.id.trim() : null;
  return {
    id,
    title: coerceString(note.title, "Untitled"),
    category: coerceString(note.category, "General"),
    content: coerceString(note.content, ""),
    isFavorite: Boolean(note.isFavorite),
    createdAt,
    updatedAt,
  };
}

function normalizeState(maybe) {
  if (!maybe || typeof maybe !== "object") return null;
  const notesRaw = Array.isArray(maybe.notes) ? maybe.notes : null;
  if (!notesRaw) return null;

  // Runtime normalization is a second line of defense on top of storage normalization.
  const normalizedNotes = notesRaw
    .map((n) => normalizeNoteForRuntime(n))
    .filter(Boolean)
    .map((n) => {
      // If id is missing for some reason, create a deterministic one (migration should cover most cases).
      const id = n.id || makeDeterministicNoteId({ ...n, createdAt: n.createdAt });
      return { ...n, id };
    });

  // Dedupe by id (keep first)
  const seen = new Set();
  const notes = [];
  for (const n of normalizedNotes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    notes.push(n);
  }

  const ui = { ...DEFAULT_STATE.ui, ...(maybe.ui || {}) };
  ui.category = coerceString(ui.category, DEFAULT_STATE.ui.category);
  ui.search = coerceString(ui.search, DEFAULT_STATE.ui.search);
  ui.sort = coerceString(ui.sort, DEFAULT_STATE.ui.sort);
  ui.favoritesOnly = Boolean(ui.favoritesOnly);
  ui.favoritesFirst = Boolean(ui.favoritesFirst);

  const selectedNoteIdRaw =
    typeof maybe.selectedNoteId === "string" && maybe.selectedNoteId.trim() ? maybe.selectedNoteId.trim() : null;

  const selectedNoteId = selectedNoteIdRaw && notes.some((n) => n.id === selectedNoteIdRaw) ? selectedNoteIdRaw : null;

  return {
    ...DEFAULT_STATE,
    ...maybe,
    // ensure we never persist runtime-only fields from storage
    uiRuntime: { ...DEFAULT_STATE.uiRuntime },
    trash: { ...DEFAULT_STATE.trash },
    notes,
    selectedNoteId,
    ui,
  };
}

function deriveCategories(notes) {
  const set = new Set();
  notes.forEach((n) => {
    if (n.category && String(n.category).trim()) set.add(String(n.category).trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function matchSearch(note, q) {
  if (!q) return true;
  const query = q.toLowerCase();
  return (
    (note.title || "").toLowerCase().includes(query) ||
    (note.content || "").toLowerCase().includes(query) ||
    (note.category || "").toLowerCase().includes(query)
  );
}

function normalizeCategoryName(value) {
  return String(value || "").trim();
}

function categoriesEqual(a, b) {
  return normalizeCategoryName(a).toLowerCase() === normalizeCategoryName(b).toLowerCase();
}

function sortNotes(notes, sortKey, favoritesFirst) {
  const arr = [...notes];
  const byUpdated = (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  const byTitle = (a, b) => (a.title || "").localeCompare(b.title || "");

  // Base comparator derived from sort key
  let cmp;
  switch (sortKey) {
    case "updated_asc":
      cmp = (a, b) => -byUpdated(a, b);
      break;
    case "title_asc":
      cmp = byTitle;
      break;
    case "title_desc":
      cmp = (a, b) => -byTitle(a, b);
      break;
    case "updated_desc":
    default:
      cmp = byUpdated;
      break;
  }

  const favFirstCmp = (a, b) => {
    if (!favoritesFirst) return 0;
    const af = a.isFavorite ? 1 : 0;
    const bf = b.isFavorite ? 1 : 0;
    // favorites first => descending by flag
    return bf - af;
  };

  return arr.sort((a, b) => favFirstCmp(a, b) || cmp(a, b));
}

function computeVisibleNotes(state) {
  const filtered = state.notes.filter((n) => {
    const catOk = state.ui.category === "All" ? true : n.category === state.ui.category;
    const qOk = matchSearch(n, state.ui.search);
    const favOk = state.ui.favoritesOnly ? Boolean(n.isFavorite) : true;
    return catOk && qOk && favOk;
  });
  return sortNotes(filtered, state.ui.sort, state.ui.favoritesFirst);
}

function ensureValidSelection(state) {
  // Keep selection stable and always valid if there are notes remaining.
  const hasSelected = state.selectedNoteId && state.notes.some((n) => n.id === state.selectedNoteId);
  if (hasSelected) return state;

  const visible = computeVisibleNotes(state);
  const nextSelected = visible[0]?.id ?? state.notes[0]?.id ?? null;
  return { ...state, selectedNoteId: nextSelected };
}

function createToast(message, actionLabel, actionKey) {
  return {
    id: `toast_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    message: String(message || ""),
    actionLabel: actionLabel ? String(actionLabel) : null,
    actionKey: actionKey ? String(actionKey) : null,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "BOOTSTRAP": {
      return ensureValidSelection(action.payload);
    }

    case "SET_TOAST": {
      return { ...state, uiRuntime: { ...state.uiRuntime, toast: action.toast } };
    }

    case "CLEAR_TOAST": {
      if (!state.uiRuntime.toast) return state;
      if (action.id && state.uiRuntime.toast.id !== action.id) return state;
      return { ...state, uiRuntime: { ...state.uiRuntime, toast: null } };
    }

    case "SET_EDITOR_DIRTY": {
      return { ...state, uiRuntime: { ...state.uiRuntime, dirty: Boolean(action.value) } };
    }

    case "SET_EDITOR_SAVING": {
      return { ...state, uiRuntime: { ...state.uiRuntime, saving: Boolean(action.value) } };
    }

    case "MARK_EDITOR_SAVED": {
      return {
        ...state,
        uiRuntime: { ...state.uiRuntime, dirty: false, saving: false, lastSavedAt: nowIso() },
      };
    }

    case "SET_CATEGORY": {
      return ensureValidSelection({ ...state, ui: { ...state.ui, category: action.category } });
    }
    case "SET_SEARCH": {
      return ensureValidSelection({ ...state, ui: { ...state.ui, search: action.search } });
    }
    case "SET_SORT": {
      return ensureValidSelection({ ...state, ui: { ...state.ui, sort: action.sort } });
    }
    case "SET_FAVORITES_ONLY": {
      return ensureValidSelection({ ...state, ui: { ...state.ui, favoritesOnly: Boolean(action.value) } });
    }
    case "SET_FAVORITES_FIRST": {
      return ensureValidSelection({ ...state, ui: { ...state.ui, favoritesFirst: Boolean(action.value) } });
    }
    case "CLEAR_FILTERS": {
      return ensureValidSelection({
        ...state,
        ui: {
          ...state.ui,
          category: "All",
          search: "",
          favoritesOnly: false,
        },
      });
    }

    case "SELECT_NOTE": {
      // Guard against selecting stale ids.
      const ok = action.id && state.notes.some((n) => n.id === action.id);
      return { ...state, selectedNoteId: ok ? action.id : state.selectedNoteId };
    }

    case "CREATE_NOTE": {
      const createdAt = nowIso();
      const base = {
        title: action.note.title || "Untitled",
        category: action.note.category || "General",
        content: action.note.content || "",
        isFavorite: Boolean(action.note.isFavorite),
        createdAt,
        updatedAt: createdAt,
      };

      const id = makeDeterministicNoteId(base);

      const newNote = {
        id,
        ...base,
      };

      // If current filters hide the newly created note (e.g., category != General), we still select it.
      return {
        ...state,
        notes: [newNote, ...state.notes],
        selectedNoteId: newNote.id,
      };
    }

    case "DUPLICATE_NOTE": {
      const source = state.notes.find((n) => n.id === action.id);
      if (!source) return state;

      const createdAt = nowIso();
      const base = {
        title: `${source.title || "Untitled"} (copy)`,
        category: source.category || "General",
        content: source.content || "",
        isFavorite: Boolean(source.isFavorite),
        createdAt,
        updatedAt: createdAt,
      };

      const id = makeDeterministicNoteId(base);
      const newNote = { id, ...base };

      return {
        ...state,
        notes: [newNote, ...state.notes],
        selectedNoteId: newNote.id,
      };
    }

    case "UPDATE_NOTE": {
      const { id, patch } = action;
      const updatedAt = nowIso();

      const nextNotes = state.notes.map((n) => {
        if (n.id !== id) return n;

        // Enforce schema + prevent accidental field deletion:
        const normalized = normalizeNoteForRuntime({ ...n, ...patch, updatedAt }) || n;
        return {
          ...n,
          ...patch,
          // Ensure schema fields remain present and well-formed
          title: normalized.title,
          category: normalized.category,
          content: normalized.content,
          isFavorite: normalized.isFavorite,
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
        };
      });

      const next = { ...state, notes: nextNotes };
      return ensureValidSelection(next);
    }

    case "RENAME_CATEGORY": {
      const from = normalizeCategoryName(action.from);
      const to = normalizeCategoryName(action.to);

      if (!from || !to) return state;
      if (categoriesEqual(from, to)) return state;

      const nextNotes = state.notes.map((n) => {
        if (!categoriesEqual(n.category, from)) return n;
        return { ...n, category: to, updatedAt: nowIso() };
      });

      const nextUiCategory =
        state.ui.category !== "All" && categoriesEqual(state.ui.category, from) ? to : state.ui.category;

      return ensureValidSelection({ ...state, notes: nextNotes, ui: { ...state.ui, category: nextUiCategory } });
    }

    case "MERGE_CATEGORIES": {
      const from = normalizeCategoryName(action.from);
      const into = normalizeCategoryName(action.into);

      if (!from || !into) return state;
      if (categoriesEqual(from, into)) return state;

      const nextNotes = state.notes.map((n) => {
        if (!categoriesEqual(n.category, from)) return n;
        return { ...n, category: into, updatedAt: nowIso() };
      });

      const nextUiCategory =
        state.ui.category !== "All" && categoriesEqual(state.ui.category, from) ? into : state.ui.category;

      return ensureValidSelection({ ...state, notes: nextNotes, ui: { ...state.ui, category: nextUiCategory } });
    }

    case "DELETE_NOTE": {
      const id = action.id;

      const deletedNote = state.notes.find((n) => n.id === id) || null;
      if (!deletedNote) return state;

      // Choose next selection based on current *visible* ordering for better UX:
      // - If deleting selected note: select adjacent (next item), else previous, else clear.
      const visibleBefore = computeVisibleNotes(state);
      const idx = visibleBefore.findIndex((n) => n.id === id);

      const remaining = state.notes.filter((n) => n.id !== id);

      let nextSelected = state.selectedNoteId;
      if (state.selectedNoteId === id) {
        const nextCandidate = visibleBefore[idx + 1]?.id ?? visibleBefore[idx - 1]?.id ?? null;
        nextSelected = nextCandidate && remaining.some((n) => n.id === nextCandidate) ? nextCandidate : null;
      }

      const nextState = ensureValidSelection({ ...state, notes: remaining, selectedNoteId: nextSelected });

      // Record in session trash and show undo toast.
      const toast = createToast(`Deleted “${deletedNote.title || "Untitled"}”.`, "Undo", "UNDO_DELETE");
      return {
        ...nextState,
        trash: { lastDeleted: { note: deletedNote, previousSelectedId: state.selectedNoteId, deletedAt: nowIso() } },
        uiRuntime: { ...nextState.uiRuntime, toast },
      };
    }

    case "UNDO_DELETE": {
      const entry = state.trash.lastDeleted;
      if (!entry?.note?.id) return state;

      // If note already exists (e.g., imported), don't duplicate.
      const exists = state.notes.some((n) => n.id === entry.note.id);
      const nextNotes = exists ? state.notes : [entry.note, ...state.notes];

      return ensureValidSelection({
        ...state,
        notes: nextNotes,
        selectedNoteId: entry.previousSelectedId && nextNotes.some((n) => n.id === entry.previousSelectedId)
          ? entry.previousSelectedId
          : state.selectedNoteId,
        trash: { lastDeleted: null },
        uiRuntime: { ...state.uiRuntime, toast: null },
      });
    }

    case "IMPORT_STATE_REPLACE": {
      const normalized = normalizeState(action.state) || normalizeState({ ...DEFAULT_STATE, ...buildDemoData() });
      const next = ensureValidSelection(normalized || DEFAULT_STATE);
      return {
        ...next,
        // reset runtime editor state on import
        uiRuntime: { ...DEFAULT_STATE.uiRuntime, toast: createToast("Import complete.", null, null) },
        trash: { ...DEFAULT_STATE.trash },
      };
    }

    default:
      return state;
  }
}

const NotesContext = createContext(null);

// PUBLIC_INTERFACE
export function NotesProvider({ children }) {
  /** Provider for notes state, actions, and derived views. */
  const [state, dispatch] = useReducer(reducer, DEFAULT_STATE);
  const bootstrappedRef = useRef(false);

  // Optional sync layer (offline-first): only tries network when API base env var is set.
  const syncRef = useRef(null);
  if (!syncRef.current) {
    syncRef.current = new SyncService({
      // Only show a non-blocking toast if the UI store is already capable of showing one.
      onNonBlockingError: (msg) => dispatch({ type: "SET_TOAST", toast: createToast(String(msg), null, null) }),
    });
  }

  // Selector cache is per-provider instance to ensure stable references.
  const selectorsRef = useRef(null);
  if (!selectorsRef.current) selectorsRef.current = createNotesSelectors();

  // Debounced persistence (avoid expensive localStorage writes on every keystroke)
  const persistTimerRef = useRef(null);
  const lastPersistedRef = useRef({ notes: [], selectedNoteId: null, ui: null });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const canUseStorage = storageAvailable();
      const saved = canUseStorage ? normalizeState(loadFromStorage()) : null;

      // Start from local (or demo) immediately; then best-effort refresh notes from API if enabled.
      const initialLocal =
        saved || normalizeState({ ...DEFAULT_STATE, ...buildDemoData() }) || { ...DEFAULT_STATE, ...buildDemoData() };

      let initial = initialLocal;

      // Optional API refresh: never blocks bootstrap if disabled or fails.
      if (getApiBaseUrl()) {
        try {
          const apiNotes = await syncRef.current.listNotes();
          if (!cancelled && Array.isArray(apiNotes)) {
            initial = normalizeState({ ...initialLocal, notes: apiNotes }) || initialLocal;
          }
        } catch {
          // SyncService already handles fallback + optional toast.
        }
      }

      if (cancelled) return;
      dispatch({ type: "BOOTSTRAP", payload: initial });
      bootstrappedRef.current = true;
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on changes (after bootstrap). We intentionally omit runtime-only parts.
  useEffect(() => {
    if (!bootstrappedRef.current) return;

    const nextPayload = { notes: state.notes, selectedNoteId: state.selectedNoteId, ui: state.ui };

    // Avoid writing if nothing materially changed (helps when runtime UI updates happen).
    const last = lastPersistedRef.current;
    const sameNotes = last.notes === nextPayload.notes || shallowEqualArray(last.notes, nextPayload.notes);
    const sameSelected = last.selectedNoteId === nextPayload.selectedNoteId;
    const sameUi = last.ui === nextPayload.ui;
    if (sameNotes && sameSelected && sameUi) return;

    // Debounce writes; last action wins.
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      // Always persist locally (offline-first). SyncService will no-op unless API is enabled.
      saveToStorage(nextPayload);
      lastPersistedRef.current = nextPayload;
      persistTimerRef.current = null;

      // Best-effort background sync: do not block UI and do not throw.
      if (getApiBaseUrl()) {
        syncRef.current.exportAll().catch(() => {});
      }
    }, 500);

    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
  }, [state.notes, state.selectedNoteId, state.ui]);

  const derived = useMemo(() => {
    const selectors = selectorsRef.current;

    const categories = selectors.getCategories(state.notes);
    const visibleNotes = selectors.getVisibleNotes(state);
    const visibleNoteIds = selectors.getVisibleNoteIds(state);
    const selectedNote = state.notes.find((n) => n.id === state.selectedNoteId) || null;

    // Derived selectors for reuse by components (no component prop changes required).
    const favorites = state.notes.filter((n) => n.isFavorite);
    const favoriteIds = new Set(favorites.map((n) => n.id));
    const visibleFavorites = visibleNotes.filter((n) => favoriteIds.has(n.id));

    const noteById = new Map(state.notes.map((n) => [n.id, n]));

    return {
      categories,
      visibleNotes,
      selectedNote,

      favorites,
      visibleFavorites,
      noteById,
      visibleNoteIds,

      // Editor/runtime selectors
      editor: {
        dirty: Boolean(state.uiRuntime.dirty),
        saving: Boolean(state.uiRuntime.saving),
        lastSavedAt: state.uiRuntime.lastSavedAt,
      },
      toast: state.uiRuntime.toast,
      canUndoDelete: Boolean(state.trash.lastDeleted),
    };
    // NOTE: state.uiRuntime and state.trash are included because derived exposes editor/toast/canUndoDelete,
    // but visible lists are memoized to the notes/ui signature so they won't churn on runtime-only changes.
  }, [state.notes, state.selectedNoteId, state.ui, state.uiRuntime, state.trash]);

  const actions = useMemo(() => {
    return {
      // PUBLIC_INTERFACE
      createNote(note) {
        /** Creates a new note and selects it. */
        dispatch({ type: "CREATE_NOTE", note });

        // Best-effort sync (offline-first): don't block UI.
        const apiEnabled = Boolean(getApiBaseUrl());
        if (apiEnabled) {
          const snapshot = normalizeNoteForRuntime(note);
          // If caller passed partial note, the reducer will normalize; we only sync if it has an id.
          if (snapshot?.id) syncRef.current.createNote(snapshot).catch(() => {});
        }
      },
      // PUBLIC_INTERFACE
      duplicateNote(id) {
        /** Duplicates a note by id and selects the new copy. */
        dispatch({ type: "DUPLICATE_NOTE", id });
        // Persist effect will handle local save and best-effort sync.
      },
      // PUBLIC_INTERFACE
      updateNote(id, patch) {
        /** Updates a note by id. */
        dispatch({ type: "UPDATE_NOTE", id, patch });
        if (getApiBaseUrl()) syncRef.current.updateNote(id, patch).catch(() => {});
      },
      // PUBLIC_INTERFACE
      deleteNote(id) {
        /** Deletes a note by id. */
        dispatch({ type: "DELETE_NOTE", id });
        if (getApiBaseUrl()) syncRef.current.deleteNote(id).catch(() => {});
      },
      // PUBLIC_INTERFACE
      undoDelete() {
        /** Restores the last deleted note (session-only). */
        dispatch({ type: "UNDO_DELETE" });
        // Note: no automatic "undelete" endpoint assumed; persistence + exportAll is best-effort.
        if (getApiBaseUrl()) syncRef.current.exportAll().catch(() => {});
      },
      // PUBLIC_INTERFACE
      selectNote(id) {
        /** Selects a note by id. */
        dispatch({ type: "SELECT_NOTE", id });
      },
      // PUBLIC_INTERFACE
      setCategory(category) {
        /** Sets the active category filter. */
        dispatch({ type: "SET_CATEGORY", category });
      },
      // PUBLIC_INTERFACE
      setSearch(search) {
        /** Sets the search query. */
        dispatch({ type: "SET_SEARCH", search });
      },
      // PUBLIC_INTERFACE
      setSort(sort) {
        /** Sets the notes sort option. */
        dispatch({ type: "SET_SORT", sort });
      },
      // PUBLIC_INTERFACE
      setFavoritesOnly(value) {
        /** Sets whether list is filtered to favorites only. */
        dispatch({ type: "SET_FAVORITES_ONLY", value });
      },
      // PUBLIC_INTERFACE
      setFavoritesFirst(value) {
        /** Sets whether sorting is grouped by favorites first. */
        dispatch({ type: "SET_FAVORITES_FIRST", value });
      },
      // PUBLIC_INTERFACE
      clearFilters() {
        /** Clears all active filters (search, category, favorites-only). */
        dispatch({ type: "CLEAR_FILTERS" });
      },
      // PUBLIC_INTERFACE
      renameCategory(from, to) {
        /** Renames a category, updating all notes that use it. */
        dispatch({ type: "RENAME_CATEGORY", from, to });
        if (getApiBaseUrl()) syncRef.current.exportAll().catch(() => {});
      },
      // PUBLIC_INTERFACE
      mergeCategories(from, into) {
        /** Merges one category into another by reassigning notes. */
        dispatch({ type: "MERGE_CATEGORIES", from, into });
        if (getApiBaseUrl()) syncRef.current.exportAll().catch(() => {});
      },

      // PUBLIC_INTERFACE
      setEditorDirty(value) {
        /** Marks whether the editor has unsaved changes (session-only). */
        dispatch({ type: "SET_EDITOR_DIRTY", value });
      },
      // PUBLIC_INTERFACE
      setEditorSaving(value) {
        /** Marks whether the editor is currently autosaving (session-only). */
        dispatch({ type: "SET_EDITOR_SAVING", value });
      },
      // PUBLIC_INTERFACE
      markEditorSaved() {
        /** Marks editor changes as saved (session-only). */
        dispatch({ type: "MARK_EDITOR_SAVED" });
      },

      // PUBLIC_INTERFACE
      showToast(message, actionLabel = null, actionKey = null) {
        /** Shows a transient toast/snackbar message. */
        dispatch({ type: "SET_TOAST", toast: createToast(message, actionLabel, actionKey) });
      },
      // PUBLIC_INTERFACE
      clearToast(id = null) {
        /** Clears the current toast/snackbar message. */
        dispatch({ type: "CLEAR_TOAST", id });
      },

      // PUBLIC_INTERFACE
      exportAllNotes() {
        /** Exports current notes state to a downloadable JSON file. */
        const payload = buildExportPayload({ notes: state.notes, selectedNoteId: state.selectedNoteId, ui: state.ui });
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `ocean-notes-export-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        URL.revokeObjectURL(url);
        dispatch({ type: "SET_TOAST", toast: createToast("Exported notes JSON.", null, null) });

        // Best-effort export sync (no-op if API disabled).
        if (getApiBaseUrl()) syncRef.current.exportAll().catch(() => {});
      },

      // PUBLIC_INTERFACE
      async importNotesFromFile(file) {
        /**
         * Imports notes from a user-selected JSON file.
         * Replaces current state (simple, predictable behavior) after validation + migration.
         */
        if (!file) return;
        const text = await file.text();
        const parsed = importStateFromJsonText(text);
        if (!parsed.ok) {
          dispatch({ type: "SET_TOAST", toast: createToast(`Import failed: ${parsed.error}`, null, null) });
          return;
        }
        dispatch({ type: "IMPORT_STATE_REPLACE", state: parsed.state });

        // Best-effort: push imported state to backend if enabled; does not affect UI behavior.
        if (getApiBaseUrl()) syncRef.current.importAll(parsed.state).catch(() => {});
      },
    };
    // We intentionally depend on state pieces used in export and toast actions.
  }, [state.notes, state.selectedNoteId, state.ui]);

  const value = useMemo(() => ({ state, derived, actions }), [state, derived, actions]);

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

// PUBLIC_INTERFACE
export function useNotes() {
  /** Hook to access notes state, derived views, and actions. */
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error("useNotes must be used within a NotesProvider");
  return ctx;
}
