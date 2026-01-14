/**
 * Local persistence helpers.
 * Keeps I/O and schema in one place so swapping to a backend later is easy.
 *
 * This module also provides guardrails:
 * - Safe parsing (never throw on bad localStorage content)
 * - Schema versioning + migrations
 * - Normalization of stored state into a known shape
 */

const STORAGE_KEY = "ocean_notes_v1";
const STORAGE_SCHEMA_VERSION = 1;

/**
 * Stored payload shape:
 * {
 *   schemaVersion: number,
 *   state: {
 *     notes: Note[],
 *     selectedNoteId: string|null,
 *     ui: { category: string, search: string, sort: string }
 *   }
 * }
 */

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // localStorage can throw in private mode, blocked cookies, or storage access denied scenarios.
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded / storage blocked. We intentionally fail silently to keep the app usable.
    return false;
  }
}

function safeStorageRemove(key) {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minimal defaults for persisted UI. We keep this here so the persisted shape is stable.
 * NotesStore also has runtime defaults, but storage normalization helps migrate/repair data.
 */
const DEFAULT_PERSISTED_STATE = {
  notes: [],
  selectedNoteId: null,
  ui: {
    category: "All",
    search: "",
    sort: "updated_desc",
  },
};

function isIsoDateString(value) {
  if (typeof value !== "string") return false;
  // We avoid a strict regex; just ensure it parses and returns a valid date.
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function coerceString(value, fallback) {
  if (typeof value === "string") return value;
  if (value == null) return fallback;
  return String(value);
}

function coerceBoolean(value) {
  return Boolean(value);
}

/**
 * Attempts to coerce/repair any unknown note shape into the formal schema:
 * (id, title, category, content, isFavorite, createdAt, updatedAt)
 *
 * IMPORTANT: We do not generate IDs here if missing because deterministic ID generation
 * for *new* notes is handled in the store. For migrations we will assign a stable,
 * deterministic ID based on content + timestamps when possible (see migrateLegacyState()).
 */
function normalizeNote(note) {
  if (!note || typeof note !== "object") return null;

  const id = typeof note.id === "string" && note.id.trim() ? note.id.trim() : null;
  const title = coerceString(note.title, "Untitled");
  const category = coerceString(note.category, "General");
  const content = coerceString(note.content, "");
  const isFavorite = coerceBoolean(note.isFavorite);

  // If legacy notes used "date" or "lastModified" fields, attempt to interpret them.
  const legacyCreated = note.createdAt ?? note.created ?? note.dateCreated ?? null;
  const legacyUpdated = note.updatedAt ?? note.updated ?? note.lastModified ?? note.dateUpdated ?? null;

  const createdAt = isIsoDateString(legacyCreated) ? legacyCreated : nowIso();
  const updatedAt = isIsoDateString(legacyUpdated) ? legacyUpdated : createdAt;

  return {
    id,
    title,
    category,
    content,
    isFavorite,
    createdAt,
    updatedAt,
  };
}

/**
 * Deterministic, stable hash (FNV-1a 32-bit) for ID generation during migrations.
 * This is NOT cryptographic; it's used only to avoid collisions and keep IDs stable.
 */
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime via bit ops
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

function stableNoteIdFromFields(noteLike) {
  const title = coerceString(noteLike?.title, "");
  const category = coerceString(noteLike?.category, "");
  const content = coerceString(noteLike?.content, "");
  const createdAt = coerceString(noteLike?.createdAt, "");
  const updatedAt = coerceString(noteLike?.updatedAt, "");
  const seed = `${title}\n${category}\n${content}\n${createdAt}\n${updatedAt}`;
  const hash = fnv1a32(seed).toString(16).padStart(8, "0");
  return `note_${hash}`;
}

function dedupeById(notes) {
  const seen = new Set();
  const out = [];
  for (const n of notes) {
    if (!n?.id || seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

/**
 * Migrate unknown/older payloads into the current persisted shape.
 * Supports:
 * - "new" payload format: { schemaVersion, state }
 * - Legacy v0 payload: direct state object (e.g., { notes: [], selectedNoteId, ui })
 * - Super-legacy: array of notes persisted directly
 */
function migrateLegacyState(rawParsed) {
  // Already in wrapper format
  if (rawParsed && typeof rawParsed === "object" && "schemaVersion" in rawParsed && "state" in rawParsed) {
    const schemaVersion = Number(rawParsed.schemaVersion);
    const state = rawParsed.state;
    return {
      schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 0,
      state,
    };
  }

  // Legacy: stored directly as array of notes
  if (Array.isArray(rawParsed)) {
    return {
      schemaVersion: 0,
      state: { ...DEFAULT_PERSISTED_STATE, notes: rawParsed },
    };
  }

  // Legacy: stored state directly
  if (rawParsed && typeof rawParsed === "object") {
    return {
      schemaVersion: 0,
      state: rawParsed,
    };
  }

  return null;
}

function normalizePersistedState(maybeState) {
  if (!maybeState || typeof maybeState !== "object") return null;

  const notesRaw = Array.isArray(maybeState.notes) ? maybeState.notes : [];
  const normalizedNotes = notesRaw
    .map((n) => normalizeNote(n))
    .filter(Boolean)
    .map((n) => {
      // For migration/repair: assign deterministic ID if missing.
      const id = n.id || stableNoteIdFromFields(n);
      return { ...n, id };
    });

  const notes = dedupeById(normalizedNotes);

  const ui = {
    ...DEFAULT_PERSISTED_STATE.ui,
    ...(maybeState.ui && typeof maybeState.ui === "object" ? maybeState.ui : {}),
  };
  ui.category = coerceString(ui.category, DEFAULT_PERSISTED_STATE.ui.category);
  ui.search = coerceString(ui.search, DEFAULT_PERSISTED_STATE.ui.search);
  ui.sort = coerceString(ui.sort, DEFAULT_PERSISTED_STATE.ui.sort);

  const selectedNoteIdRaw =
    typeof maybeState.selectedNoteId === "string" && maybeState.selectedNoteId.trim()
      ? maybeState.selectedNoteId.trim()
      : null;

  const selectedNoteId = selectedNoteIdRaw && notes.some((n) => n.id === selectedNoteIdRaw) ? selectedNoteIdRaw : null;

  return {
    ...DEFAULT_PERSISTED_STATE,
    ...maybeState,
    notes,
    ui,
    selectedNoteId,
  };
}

// PUBLIC_INTERFACE
export function buildDemoData() {
  /** Returns initial demo notes and categories. */
  const t = nowIso();
  const demoNotes = [
    {
      id: "note_demo_1",
      title: "Welcome to Ocean Notes",
      category: "General",
      content:
        "# Ocean Notes\n\nThis is a lightweight notes organizer.\n\n- Create notes\n- Search and filter by category\n- Sort by *Last updated*\n\nTip: try **Markdown-lite** like headings and lists.",
      createdAt: t,
      updatedAt: t,
      isFavorite: true,
    },
    {
      id: "note_demo_2",
      title: "Project ideas",
      category: "Work",
      content: "## Ideas\n\n- Weekly review template\n- Meeting notes with action items\n- Lightweight personal wiki",
      createdAt: t,
      updatedAt: t,
      isFavorite: false,
    },
    {
      id: "note_demo_3",
      title: "Grocery list",
      category: "Personal",
      content: "- Oats\n- Blueberries\n- Coffee\n- Sparkling water",
      createdAt: t,
      updatedAt: t,
      isFavorite: false,
    },
  ];

  return { notes: demoNotes };
}

// PUBLIC_INTERFACE
export function loadFromStorage() {
  /**
   * Loads notes state from localStorage; returns null if missing/unreadable.
   * Performs migration + normalization and will auto-repair saved data when possible.
   */
  if (typeof window === "undefined") return null;

  const raw = safeStorageGet(STORAGE_KEY);
  if (!raw) return null;

  const parsed = safeJsonParse(raw);
  const migrated = migrateLegacyState(parsed);
  if (!migrated) return null;

  const normalizedState = normalizePersistedState(migrated.state);
  if (!normalizedState) return null;

  const normalizedPayload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    state: normalizedState,
  };

  // If old schema detected or wrapper missing, rewrite in new format (best-effort).
  if (migrated.schemaVersion !== STORAGE_SCHEMA_VERSION || !(parsed && typeof parsed === "object" && "state" in parsed)) {
    safeStorageSet(STORAGE_KEY, JSON.stringify(normalizedPayload));
  }

  return normalizedState;
}

// PUBLIC_INTERFACE
export function saveToStorage(state) {
  /** Persists notes state to localStorage with schema version wrapper. */
  if (typeof window === "undefined") return false;

  const normalizedState = normalizePersistedState(state) || DEFAULT_PERSISTED_STATE;

  const payload = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    state: normalizedState,
  };

  return safeStorageSet(STORAGE_KEY, JSON.stringify(payload));
}

// PUBLIC_INTERFACE
export function storageAvailable() {
  /** Returns true if localStorage is accessible and writable. */
  if (typeof window === "undefined") return false;
  const ok = safeStorageSet("__ocean_notes_probe__", "1");
  // Best-effort cleanup
  safeStorageRemove("__ocean_notes_probe__");
  return ok;
}

// PUBLIC_INTERFACE
export function getStorageSchemaVersion() {
  /** Returns the current storage schema version for the persisted payload wrapper. */
  return STORAGE_SCHEMA_VERSION;
}
