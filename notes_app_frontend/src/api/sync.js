import { apiClient, getApiBaseUrl } from "./client";
import { loadFromStorage, saveToStorage } from "../store/storage";

/**
 * SyncService: thin optional sync layer.
 *
 * Switch behavior:
 * - If neither REACT_APP_API_BASE nor REACT_APP_BACKEND_URL is set: operates in localStorage-only mode (no network calls).
 * - If an API base is set: attempts REST calls to /notes CRUD; if a request fails/times out, it falls back to localStorage seamlessly
 *   (offline-first behavior).
 *
 * To enable API mode, set:
 *   REACT_APP_API_BASE="https://your-api.example.com"
 * or
 *   REACT_APP_BACKEND_URL="https://your-api.example.com"
 * (REACT_APP_API_BASE takes precedence if both are set).
 */

const DEFAULT_TIMEOUT_MS = 4500;

function withTimeout(promise, timeoutMs) {
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("Request timed out")), ms);
    promise.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      }
    );
  });
}

function normalizeNoteFromApi(n) {
  if (!n || typeof n !== "object") return null;
  const id = typeof n.id === "string" ? n.id : null;
  if (!id) return null;
  return {
    id,
    title: typeof n.title === "string" ? n.title : "Untitled",
    category: typeof n.category === "string" ? n.category : "General",
    content: typeof n.content === "string" ? n.content : "",
    isFavorite: Boolean(n.isFavorite),
    createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
    updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
  };
}

function normalizeNotesArrayFromApi(payload) {
  const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.notes) ? payload.notes : null;
  if (!Array.isArray(arr)) return null;
  const out = arr.map(normalizeNoteFromApi).filter(Boolean);
  return out;
}

function computePatch(prev, next) {
  const patch = {};
  const fields = ["title", "category", "content", "isFavorite", "createdAt", "updatedAt"];
  for (const f of fields) {
    if (typeof next?.[f] === "undefined") continue;
    if (prev?.[f] !== next?.[f]) patch[f] = next[f];
  }
  return patch;
}

// PUBLIC_INTERFACE
export class SyncService {
  /** Optional sync layer that uses REST when configured, otherwise localStorage. */
  constructor({ timeoutMs = DEFAULT_TIMEOUT_MS, onNonBlockingError = null } = {}) {
    this.timeoutMs = timeoutMs;
    // Optional callback to surface non-blocking errors (e.g., dispatch toast if already wired).
    this.onNonBlockingError = typeof onNonBlockingError === "function" ? onNonBlockingError : null;
  }

  _apiEnabled() {
    return Boolean(getApiBaseUrl());
  }

  _notify(message) {
    if (!this.onNonBlockingError) return;
    try {
      this.onNonBlockingError(String(message || "Sync failed; using offline data."));
    } catch {
      // never let notifications break core flow
    }
  }

  _readLocalState() {
    return loadFromStorage() || { notes: [], selectedNoteId: null, ui: { category: "All", search: "", sort: "updated_desc" } };
  }

  _writeLocalNotesOnly(notes) {
    const current = this._readLocalState();
    saveToStorage({ ...current, notes });
  }

  async _tryApi(fn) {
    // No calls made when unset.
    if (!this._apiEnabled()) return { ok: false, reason: "disabled" };

    try {
      const result = await withTimeout(Promise.resolve().then(fn), this.timeoutMs);
      return { ok: true, result };
    } catch (e) {
      this._notify(e?.message || "Network error");
      return { ok: false, error: e };
    }
  }

  // PUBLIC_INTERFACE
  async listNotes() {
    /** Returns notes array (from API when configured; otherwise from localStorage). */
    const local = this._readLocalState();

    const api = await this._tryApi(() => apiClient.listNotes());
    if (!api.ok || api.result == null) return local.notes;

    const apiNotes = normalizeNotesArrayFromApi(api.result);
    if (!apiNotes) return local.notes;

    // Keep local cache updated for offline usage.
    this._writeLocalNotesOnly(apiNotes);
    return apiNotes;
  }

  // PUBLIC_INTERFACE
  async getNote(id) {
    /** Returns a note by id (prefers API when configured; falls back to local). */
    const local = this._readLocalState();
    const localNote = local.notes.find((n) => n.id === id) || null;

    // client.js doesn't implement GET /notes/:id; keep API mode graceful.
    return localNote;
  }

  // PUBLIC_INTERFACE
  async createNote(note) {
    /** Creates a note. Returns created note if possible, else null (caller can ignore). */
    // Optimistically update local first (offline-first).
    const local = this._readLocalState();
    const nextNotes = [note, ...local.notes.filter((n) => n.id !== note.id)];
    this._writeLocalNotesOnly(nextNotes);

    const api = await this._tryApi(() => apiClient.createNote(note));
    // If API returns note(s), update local cache.
    const created = normalizeNoteFromApi(api.result) || null;
    if (api.ok && created) {
      const merged = [created, ...nextNotes.filter((n) => n.id !== created.id)];
      this._writeLocalNotesOnly(merged);
      return created;
    }
    return null;
  }

  // PUBLIC_INTERFACE
  async updateNote(id, patch) {
    /** Updates a note by id. Returns updated note if available, else null. */
    // Update local first (offline-first).
    const local = this._readLocalState();
    const prev = local.notes.find((n) => n.id === id) || null;
    const nextLocalNotes = local.notes.map((n) => (n.id === id ? { ...n, ...patch } : n));
    this._writeLocalNotesOnly(nextLocalNotes);

    const api = await this._tryApi(() => apiClient.updateNote(id, patch));
    const updated = normalizeNoteFromApi(api.result) || null;
    if (api.ok && updated) {
      const merged = nextLocalNotes.map((n) => (n.id === id ? { ...n, ...updated } : n));
      this._writeLocalNotesOnly(merged);
      return updated;
    }

    // If API didn't return a note, but we have prev/patch, return best-effort local note.
    if (prev) return { ...prev, ...patch };
    return null;
  }

  // PUBLIC_INTERFACE
  async deleteNote(id) {
    /** Deletes a note by id. Returns true on success (local success always true). */
    // Offline-first: remove locally immediately.
    const local = this._readLocalState();
    const nextNotes = local.notes.filter((n) => n.id !== id);
    this._writeLocalNotesOnly(nextNotes);

    await this._tryApi(() => apiClient.deleteNote(id));
    return true;
  }

  // PUBLIC_INTERFACE
  async importAll(state) {
    /**
     * Imports/replaces all notes (and selection/ui) into local storage.
     * API mode is best-effort: no guaranteed bulk endpoint exists, so we attempt per-note upserts.
     */
    saveToStorage(state);

    // Best-effort: sync notes individually if API enabled.
    if (!this._apiEnabled()) return true;

    const local = this._readLocalState();
    const notes = Array.isArray(local.notes) ? local.notes : [];

    // Try to "upsert" by create then update fallback. Keep it resilient.
    for (const n of notes) {
      const createRes = await this._tryApi(() => apiClient.createNote(n));
      if (createRes.ok) continue;

      // If create failed, try patching with full note as patch.
      const patch = computePatch(null, n);
      await this._tryApi(() => apiClient.updateNote(n.id, patch));
    }

    return true;
  }

  // PUBLIC_INTERFACE
  async exportAll() {
    /** Returns current persisted state (after attempting API refresh in API mode). */
    // Refresh local cache from API when possible.
    await this.listNotes();
    return this._readLocalState();
  }
}

export const syncService = new SyncService();
