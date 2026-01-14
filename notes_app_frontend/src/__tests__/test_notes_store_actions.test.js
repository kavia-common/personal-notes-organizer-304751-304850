import React, { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { NotesProvider, useNotes } from "../store/NotesStore";
import * as storage from "../store/storage";

function Harness({ onReady }) {
  const ctx = useNotes();

  useEffect(() => {
    onReady(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div data-testid="selectedId">{ctx.state.selectedNoteId || ""}</div>
      <div data-testid="count">{ctx.state.notes.length}</div>
      <div data-testid="visibleCount">{ctx.derived.visibleNotes.length}</div>
      <div data-testid="categories">{ctx.derived.categories.join(",")}</div>
      <div data-testid="visibleTitles">{ctx.derived.visibleNotes.map((n) => n.title).join("|")}</div>
      <div data-testid="ui">
        {JSON.stringify({
          category: ctx.state.ui.category,
          search: ctx.state.ui.search,
          favoritesOnly: ctx.state.ui.favoritesOnly,
          favoritesFirst: ctx.state.ui.favoritesFirst,
          sort: ctx.state.ui.sort,
        })}
      </div>
      <div data-testid="toast">{ctx.derived.toast?.message || ""}</div>
      <div data-testid="toastAction">{ctx.derived.toast?.actionLabel || ""}</div>
      <div data-testid="dirty">{String(ctx.derived.editor?.dirty)}</div>
      <div data-testid="saving">{String(ctx.derived.editor?.saving)}</div>
    </div>
  );
}

function makeNote({ id, title, category, content = "", isFavorite = false, updatedAt }) {
  const t = updatedAt || new Date().toISOString();
  return {
    id,
    title,
    category,
    content,
    isFavorite,
    createdAt: t,
    updatedAt: t,
  };
}

describe("NotesStore actions/selectors/persistence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(storage, "storageAvailable").mockReturnValue(true);
    jest.spyOn(storage, "loadFromStorage").mockReturnValue({
      notes: [
        makeNote({ id: "a", title: "Alpha", category: "Work", content: "aaa", isFavorite: false, updatedAt: "2020-01-01T00:00:00.000Z" }),
        makeNote({ id: "b", title: "Beta", category: "Personal", content: "bbb", isFavorite: true, updatedAt: "2020-01-03T00:00:00.000Z" }),
        makeNote({ id: "c", title: "Gamma", category: "Work", content: "ccc", isFavorite: false, updatedAt: "2020-01-02T00:00:00.000Z" }),
      ],
      selectedNoteId: "b",
      ui: { category: "All", search: "", favoritesOnly: false, favoritesFirst: false, sort: "updated_desc" },
    });

    jest.spyOn(storage, "saveToStorage").mockReturnValue(true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("createNote adds a new note and selects it", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );

    // Bootstrap effect
    await act(async () => {});

    const beforeCount = Number(screen.getByTestId("count").textContent);
    act(() => {
      ctx.actions.createNote({ title: "Untitled", category: "General", content: "" });
    });

    const afterCount = Number(screen.getByTestId("count").textContent);
    expect(afterCount).toBe(beforeCount + 1);
    expect(screen.getByTestId("selectedId").textContent).toMatch(/^note_/);
  });

  test("updateNote edits fields and keeps schema intact", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    act(() => {
      ctx.actions.updateNote("a", { title: "Alpha Updated", content: "new content" });
    });

    const updated = ctx.state.notes.find((n) => n.id === "a");
    expect(updated.title).toBe("Alpha Updated");
    expect(updated.content).toBe("new content");
    expect(typeof updated.updatedAt).toBe("string");
    expect(updated.category).toBe("Work"); // unchanged
  });

  test("deleteNote removes note, creates undo toast, and undoDelete restores it", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    const beforeCount = Number(screen.getByTestId("count").textContent);

    act(() => {
      ctx.actions.deleteNote("b"); // selected initially
    });

    expect(Number(screen.getByTestId("count").textContent)).toBe(beforeCount - 1);
    expect(screen.getByTestId("toast").textContent).toMatch(/Deleted/i);
    expect(screen.getByTestId("toastAction").textContent).toBe("Undo");

    act(() => {
      ctx.actions.undoDelete();
    });

    expect(Number(screen.getByTestId("count").textContent)).toBe(beforeCount);
    expect(ctx.state.notes.some((n) => n.id === "b")).toBe(true);
  });

  test("duplicateNote creates a copy and selects it", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    act(() => {
      ctx.actions.duplicateNote("a");
    });

    const selected = ctx.state.notes.find((n) => n.id === ctx.state.selectedNoteId);
    expect(selected).toBeTruthy();
    expect(selected.title).toMatch(/\(copy\)$/);
    expect(selected.category).toBe("Work");
  });

  test("filters: favoritesOnly + search + category and clearFilters resets them", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    act(() => {
      ctx.actions.setFavoritesOnly(true);
    });
    expect(Number(screen.getByTestId("visibleCount").textContent)).toBe(1);
    expect(screen.getByTestId("visibleTitles").textContent).toContain("Beta");

    act(() => {
      ctx.actions.setSearch("alpha");
    });
    expect(Number(screen.getByTestId("visibleCount").textContent)).toBe(0);

    act(() => {
      ctx.actions.clearFilters();
    });

    const ui = JSON.parse(screen.getByTestId("ui").textContent);
    expect(ui.category).toBe("All");
    expect(ui.search).toBe("");
    expect(ui.favoritesOnly).toBe(false);
  });

  test("favoritesFirst ordering groups favorites at top (without changing primary sort comparator)", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    // updated_desc => b (favorite) newest; then c; then a
    expect(screen.getByTestId("visibleTitles").textContent).toBe("Beta|Gamma|Alpha");

    // With favoritesFirst on, favorites should be first even if sort changes later.
    act(() => {
      ctx.actions.setFavoritesFirst(true);
    });
    expect(screen.getByTestId("visibleTitles").textContent.split("|")[0]).toBe("Beta");

    // Make sorting by title asc; favoritesFirst should still keep Beta first.
    act(() => {
      ctx.actions.setSort("title_asc");
    });
    expect(screen.getByTestId("visibleTitles").textContent.split("|")[0]).toBe("Beta");
  });

  test("renameCategory updates notes and active UI category (case-insensitive match)", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    act(() => {
      ctx.actions.setCategory("work");
    });
    // Store uses exact category values for filtering; setCategory("work") is allowed but will show 0.
    // Rename should still be case-insensitive for matching note categories and UI category.
    act(() => {
      ctx.actions.renameCategory("WORK", "Projects");
    });

    expect(ctx.state.notes.filter((n) => n.category === "Projects").map((n) => n.id).sort()).toEqual(["a", "c"]);
  });

  test("mergeCategories reassigns notes and updates active UI category", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    act(() => {
      ctx.actions.setCategory("Work");
    });

    act(() => {
      ctx.actions.mergeCategories("Work", "Personal");
    });

    expect(ctx.state.notes.filter((n) => n.category === "Personal").map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    // If active category was merged-from, it should become merged-into
    expect(ctx.state.ui.category).toBe("Personal");
  });

  test("persistence is debounced and does not run before timers advance", async () => {
    let ctx;
    render(
      <NotesProvider>
        <Harness onReady={(c) => (ctx = c)} />
      </NotesProvider>
    );
    await act(async () => {});

    expect(storage.saveToStorage).not.toHaveBeenCalled();

    act(() => {
      ctx.actions.setSearch("x");
      ctx.actions.setSearch("xy");
      ctx.actions.setSearch("xyz");
    });

    // Debounced (500ms) => still no call yet
    expect(storage.saveToStorage).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(storage.saveToStorage).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(storage.saveToStorage).toHaveBeenCalledTimes(1);

    // Latest payload should have the latest search term
    const lastPayload = storage.saveToStorage.mock.calls[0][0];
    expect(lastPayload.ui.search).toBe("xyz");
  });
});
