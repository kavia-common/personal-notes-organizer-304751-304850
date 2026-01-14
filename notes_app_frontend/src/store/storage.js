/**
 * Local persistence helpers. Keeps I/O and schema in one place so swapping to a backend later is easy.
 */

const STORAGE_KEY = "ocean_notes_v1";

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

// PUBLIC_INTERFACE
export function buildDemoData() {
  /** Returns initial demo notes and categories. */
  const demoNotes = [
    {
      id: "note_demo_1",
      title: "Welcome to Ocean Notes",
      category: "General",
      content:
        "# Ocean Notes\n\nThis is a lightweight notes organizer.\n\n- Create notes\n- Search and filter by category\n- Sort by *Last updated*\n\nTip: try **Markdown-lite** like headings and lists.",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      isFavorite: true,
    },
    {
      id: "note_demo_2",
      title: "Project ideas",
      category: "Work",
      content:
        "## Ideas\n\n- Weekly review template\n- Meeting notes with action items\n- Lightweight personal wiki",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      isFavorite: false,
    },
    {
      id: "note_demo_3",
      title: "Grocery list",
      category: "Personal",
      content: "- Oats\n- Blueberries\n- Coffee\n- Sparkling water",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      isFavorite: false,
    },
  ];

  return { notes: demoNotes };
}

// PUBLIC_INTERFACE
export function loadFromStorage() {
  /** Loads notes state from localStorage; returns null if missing/unreadable. */
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return safeJsonParse(raw);
}

// PUBLIC_INTERFACE
export function saveToStorage(state) {
  /** Persists notes state to localStorage. */
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
