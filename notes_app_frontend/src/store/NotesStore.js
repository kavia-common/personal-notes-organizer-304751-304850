import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { buildDemoData, loadFromStorage, saveToStorage, storageAvailable } from "./storage";

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
  ui: {
    category: "All",
    search: "",
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

  const selectedNoteIdRaw =
    typeof maybe.selectedNoteId === "string" && maybe.selectedNoteId.trim() ? maybe.selectedNoteId.trim() : null;

  const selectedNoteId = selectedNoteIdRaw && notes.some((n) => n.id === selectedNoteIdRaw) ? selectedNoteIdRaw : null;

  return {
    ...DEFAULT_STATE,
    ...maybe,
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

function sortNotes(notes, sortKey) {
  const arr = [...notes];
  const byUpdated = (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  const byTitle = (a, b) => (a.title || "").localeCompare(b.title || "");

  switch (sortKey) {
    case "updated_asc":
      return arr.sort((a, b) => -byUpdated(a, b));
    case "title_asc":
      return arr.sort(byTitle);
    case "title_desc":
      return arr.sort((a, b) => -byTitle(a, b));
    case "updated_desc":
    default:
      return arr.sort(byUpdated);
  }
}

function computeVisibleNotes(state) {
  const filtered = state.notes.filter((n) => {
    const catOk = state.ui.category === "All" ? true : n.category === state.ui.category;
    const qOk = matchSearch(n, state.ui.search);
    return catOk && qOk;
  });
  return sortNotes(filtered, state.ui.sort);
}

function ensureValidSelection(state) {
  // Keep selection stable and always valid if there are notes remaining.
  const hasSelected = state.selectedNoteId && state.notes.some((n) => n.id === state.selectedNoteId);
  if (hasSelected) return state;

  const visible = computeVisibleNotes(state);
  const nextSelected = visible[0]?.id ?? state.notes[0]?.id ?? null;
  return { ...state, selectedNoteId: nextSelected };
}

function reducer(state, action) {
  switch (action.type) {
    case "BOOTSTRAP": {
      return ensureValidSelection(action.payload);
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
    case "DELETE_NOTE": {
      const id = action.id;

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

      return ensureValidSelection({ ...state, notes: remaining, selectedNoteId: nextSelected });
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

  useEffect(() => {
    const canUseStorage = storageAvailable();
    const saved = canUseStorage ? normalizeState(loadFromStorage()) : null;

    // Seed demo data only when we can access storage and nothing exists yet.
    // If storage is blocked, we still seed demo data for usability, but it won't persist.
    const initial = saved || normalizeState({ ...DEFAULT_STATE, ...buildDemoData() }) || { ...DEFAULT_STATE, ...buildDemoData() };

    dispatch({ type: "BOOTSTRAP", payload: initial });
    bootstrappedRef.current = true;
  }, []);

  // Persist on changes (after bootstrap)
  useEffect(() => {
    if (!bootstrappedRef.current) return;
    saveToStorage(state);
  }, [state]);

  const derived = useMemo(() => {
    const categories = deriveCategories(state.notes);
    const visibleNotes = computeVisibleNotes(state);
    const selectedNote = state.notes.find((n) => n.id === state.selectedNoteId) || null;

    // Derived selectors for reuse by components (no component prop changes required).
    const favorites = state.notes.filter((n) => n.isFavorite);
    const favoriteIds = new Set(favorites.map((n) => n.id));
    const visibleFavorites = visibleNotes.filter((n) => favoriteIds.has(n.id));

    const noteById = new Map(state.notes.map((n) => [n.id, n]));
    const visibleNoteIds = visibleNotes.map((n) => n.id);

    return {
      categories,
      visibleNotes,
      selectedNote,

      // New derived selectors (safe additions; existing UI continues using visibleNotes/selectedNote/categories)
      favorites,
      visibleFavorites,
      noteById,
      visibleNoteIds,
    };
  }, [state.notes, state.selectedNoteId, state.ui]);

  const actions = useMemo(() => {
    return {
      // PUBLIC_INTERFACE
      createNote(note) {
        /** Creates a new note and selects it. */
        dispatch({ type: "CREATE_NOTE", note });
      },
      // PUBLIC_INTERFACE
      updateNote(id, patch) {
        /** Updates a note by id. */
        dispatch({ type: "UPDATE_NOTE", id, patch });
      },
      // PUBLIC_INTERFACE
      deleteNote(id) {
        /** Deletes a note by id. */
        dispatch({ type: "DELETE_NOTE", id });
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
    };
  }, []);

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
