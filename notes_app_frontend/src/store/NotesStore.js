import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { buildDemoData, loadFromStorage, saveToStorage } from "./storage";

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `note_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
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

function normalizeState(maybe) {
  if (!maybe || typeof maybe !== "object") return null;
  if (!Array.isArray(maybe.notes)) return null;
  return {
    ...DEFAULT_STATE,
    ...maybe,
    ui: { ...DEFAULT_STATE.ui, ...(maybe.ui || {}) },
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

function reducer(state, action) {
  switch (action.type) {
    case "BOOTSTRAP": {
      return action.payload;
    }
    case "SET_CATEGORY": {
      return { ...state, ui: { ...state.ui, category: action.category } };
    }
    case "SET_SEARCH": {
      return { ...state, ui: { ...state.ui, search: action.search } };
    }
    case "SET_SORT": {
      return { ...state, ui: { ...state.ui, sort: action.sort } };
    }
    case "SELECT_NOTE": {
      return { ...state, selectedNoteId: action.id };
    }
    case "CREATE_NOTE": {
      const createdAt = nowIso();
      const newNote = {
        id: makeId(),
        title: action.note.title || "Untitled",
        category: action.note.category || "General",
        content: action.note.content || "",
        isFavorite: Boolean(action.note.isFavorite),
        createdAt,
        updatedAt: createdAt,
      };
      return {
        ...state,
        notes: [newNote, ...state.notes],
        selectedNoteId: newNote.id,
      };
    }
    case "UPDATE_NOTE": {
      const { id, patch } = action;
      const updatedAt = nowIso();
      return {
        ...state,
        notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt } : n)),
      };
    }
    case "DELETE_NOTE": {
      const id = action.id;
      const remaining = state.notes.filter((n) => n.id !== id);
      const nextSelected = state.selectedNoteId === id ? (remaining[0]?.id ?? null) : state.selectedNoteId;
      return { ...state, notes: remaining, selectedNoteId: nextSelected };
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

  useEffect(() => {
    const saved = normalizeState(loadFromStorage());
    const initial = saved || { ...DEFAULT_STATE, ...buildDemoData() };
    const selected = initial.selectedNoteId || (initial.notes[0]?.id ?? null);
    dispatch({ type: "BOOTSTRAP", payload: { ...initial, selectedNoteId: selected } });
  }, []);

  // Persist on changes (after bootstrap)
  useEffect(() => {
    if (!state.notes.length && !state.selectedNoteId) return;
    saveToStorage(state);
  }, [state]);

  const derived = useMemo(() => {
    const categories = deriveCategories(state.notes);
    const filtered = state.notes.filter((n) => {
      const catOk = state.ui.category === "All" ? true : n.category === state.ui.category;
      const qOk = matchSearch(n, state.ui.search);
      return catOk && qOk;
    });
    const sorted = sortNotes(filtered, state.ui.sort);
    const selectedNote = state.notes.find((n) => n.id === state.selectedNoteId) || null;

    return { categories, visibleNotes: sorted, selectedNote };
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
