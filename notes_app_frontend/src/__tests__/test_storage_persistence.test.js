import {
  buildExportPayload,
  getStorageSchemaVersion,
  importStateFromJsonText,
  loadFromStorage,
  saveToStorage,
  storageAvailable,
} from "../store/storage";

function mockLocalStorage() {
  let store = new Map();

  return {
    getItem: jest.fn((k) => (store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => {
      store.set(k, String(v));
    }),
    removeItem: jest.fn((k) => {
      store.delete(k);
    }),
    __getStore: () => store,
    __reset: () => {
      store = new Map();
    },
  };
}

describe("storage helpers", () => {
  let ls;

  beforeEach(() => {
    ls = mockLocalStorage();
    Object.defineProperty(window, "localStorage", { value: ls, configurable: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("storageAvailable probes and cleans up", () => {
    expect(storageAvailable()).toBe(true);
    expect(ls.setItem).toHaveBeenCalledWith("__ocean_notes_probe__", "1");
    expect(ls.removeItem).toHaveBeenCalledWith("__ocean_notes_probe__");
  });

  test("saveToStorage writes wrapper with schemaVersion", () => {
    const ok = saveToStorage({
      notes: [{ id: "n1", title: "T", category: "C", content: "", isFavorite: false, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" }],
      selectedNoteId: "n1",
      ui: { category: "All", search: "", sort: "updated_desc" },
    });

    expect(ok).toBe(true);
    const firstWrite = ls.setItem.mock.calls.find(([key]) => key === "ocean_notes_v1");
    expect(firstWrite).toBeTruthy();
    const payload = JSON.parse(firstWrite[1]);
    expect(payload.schemaVersion).toBe(getStorageSchemaVersion());
    expect(payload.state.notes).toHaveLength(1);
  });

  test("loadFromStorage returns null on invalid JSON (safe parse)", () => {
    ls.setItem("ocean_notes_v1", "{not-json");
    expect(loadFromStorage()).toBeNull();
  });

  test("loadFromStorage migrates legacy array-of-notes payload and rewrites wrapper", () => {
    // Legacy saved format: array of notes directly
    ls.setItem(
      "ocean_notes_v1",
      JSON.stringify([
        {
          // missing id => should be assigned deterministically in normalization
          title: "Legacy",
          category: "Old",
          content: "c",
          isFavorite: 1,
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-02T00:00:00.000Z",
        },
      ])
    );

    const state = loadFromStorage();
    expect(state).toBeTruthy();
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].id).toMatch(/^note_/);

    // Rewrite should have occurred
    const rewritten = ls.setItem.mock.calls.find(([key]) => key === "ocean_notes_v1");
    expect(rewritten).toBeTruthy();
    const payload = JSON.parse(rewritten[1]);
    expect(payload.schemaVersion).toBe(getStorageSchemaVersion());
    expect(payload.state.notes[0].id).toMatch(/^note_/);
  });

  test("importStateFromJsonText rejects invalid json and accepts notes arrays", () => {
    expect(importStateFromJsonText("not-json").ok).toBe(false);

    const parsed = importStateFromJsonText(
      JSON.stringify([
        { title: "A", category: "C", content: "", isFavorite: false, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" },
      ])
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.state.notes).toHaveLength(1);
    expect(parsed.state.notes[0].id).toMatch(/^note_/); // assigned during normalization
  });

  test("buildExportPayload wraps state and normalizes it", () => {
    const payload = buildExportPayload({
      notes: [{ title: "No id", category: "C", content: "", isFavorite: false, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" }],
      selectedNoteId: "missing",
      ui: { category: "All", search: "", sort: "updated_desc" },
    });

    expect(payload.exportVersion).toBe(1);
    expect(payload.schemaVersion).toBe(getStorageSchemaVersion());
    expect(payload.state.notes[0].id).toMatch(/^note_/);
    // invalid selected id should be cleared
    expect(payload.state.selectedNoteId).toBeNull();
  });
});
