import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import * as storage from "../store/storage";

function seedState() {
  return {
    notes: [
      {
        id: "n1",
        title: "Alpha",
        category: "Work",
        content: "aaa",
        isFavorite: false,
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "n2",
        title: "Beta",
        category: "Personal",
        content: "bbb",
        isFavorite: true,
        createdAt: "2020-01-02T00:00:00.000Z",
        updatedAt: "2020-01-03T00:00:00.000Z",
      },
      {
        id: "n3",
        title: "Gamma",
        category: "Work",
        content: "ccc",
        isFavorite: false,
        createdAt: "2020-01-02T00:00:00.000Z",
        updatedAt: "2020-01-02T00:00:00.000Z",
      },
    ],
    selectedNoteId: "n2",
    ui: { category: "All", search: "", favoritesOnly: false, favoritesFirst: false, sort: "updated_desc" },
  };
}

describe("App UI flows", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(storage, "storageAvailable").mockReturnValue(true);
    jest.spyOn(storage, "loadFromStorage").mockReturnValue(seedState());
    jest.spyOn(storage, "saveToStorage").mockReturnValue(true);

    jest.spyOn(window, "confirm").mockImplementation(() => true);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("creating a note selects it and editor autosaves after debounce", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<App />);
    // Create new note
    await user.click(screen.getByRole("button", { name: /create a new note/i }));

    // Editor should now have title input (selected new note)
    const titleInput = await screen.findByRole("textbox", { name: /note title/i });

    // Type triggers pending autosave
    await user.clear(titleInput);
    await user.type(titleInput, "My new note");

    expect(screen.getByLabelText(/pending changes|saving|saved/i)).toBeInTheDocument();

    // Autosave debounce in NoteEditor is 650ms
    act(() => {
      jest.advanceTimersByTime(649);
    });
    // still not saved
    expect(screen.getByLabelText(/saving|pending changes/i)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    // After save, badge should become "Saved" (via markEditorSaved)
    expect(screen.getByLabelText(/saved/i)).toBeInTheDocument();
  });

  test("delete shows undo toast and undo restores note", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    // Currently selected is n2, delete it from editor
    await user.click(screen.getByRole("button", { name: /delete note/i }));

    const toast = await screen.findByRole("status", { name: /notification/i });
    expect(toast).toHaveTextContent(/Deleted/i);

    await user.click(within(toast).getByRole("button", { name: /undo/i }));

    // Note should reappear in list
    expect(await screen.findByRole("button", { name: /open note beta/i })).toBeInTheDocument();
  });

  test("search and category filtering works and clear resets filters", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    const search = screen.getByRole("textbox", { name: /search notes/i });
    await user.type(search, "alpha");

    expect(screen.getByRole("button", { name: /open note alpha/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open note beta/i })).not.toBeInTheDocument();

    // Choose category Work should keep Alpha visible; choose Personal would hide it
    await user.click(screen.getByRole("button", { name: /filter by category work/i }));
    expect(screen.getByRole("button", { name: /open note alpha/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear all active filters/i }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: /open note beta/i })).toBeInTheDocument();
  });

  test("favorites-only toggle filters list; favorites-first ordering affects visible ordering", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    // favorites only => only Beta
    await user.click(screen.getByRole("button", { name: /toggle favorites-only filter/i }));
    expect(screen.getByRole("button", { name: /open note beta/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open note alpha/i })).not.toBeInTheDocument();

    // turn off favorites-only
    await user.click(screen.getByRole("button", { name: /toggle favorites-only filter/i }));
    expect(screen.getByRole("button", { name: /open note alpha/i })).toBeInTheDocument();

    // enable favorites-first ordering; verify favorites are first in listbox order
    await user.click(screen.getByRole("button", { name: /toggle favorites-first ordering/i }));
    const listbox = screen.getByRole("listbox", { name: /notes results/i });
    const options = within(listbox).getAllByRole("option");
    // First option should be Beta (favorite)
    expect(options[0]).toHaveAccessibleName(/open note beta/i);
  });

  test("duplicate note quick action creates a copy", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    // duplicate Alpha via quick action on its row
    const alphaRow = await screen.findByRole("button", { name: /open note alpha/i });
    const rowWrap = alphaRow.closest("div"); // rowWrap is parent, quick actions sibling
    // Safer: locate the Duplicate quick button by accessible name
    const duplicateBtn = screen.getByRole("button", { name: /duplicate note alpha/i });
    await user.click(duplicateBtn);

    // Copy should appear with "(copy)" title in list
    expect(await screen.findByRole("button", { name: /open note alpha \(copy\)/i })).toBeInTheDocument();
  });

  test("mobile sidebar toggle is accessible (aria-expanded) and closes on Escape returning focus", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    const toggle = screen.getByRole("button", { name: /show filters sidebar/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // focus returned (async via setTimeout(0))
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(toggle).toHaveFocus();
  });

  test("notes list keyboard navigation: Arrow/Home/End changes active descendant selection", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<App />);

    const listbox = screen.getByRole("listbox", { name: /notes results/i });
    listbox.focus();
    expect(listbox).toHaveFocus();

    // initial selected is Beta => aria-activedescendant is note-option-n2
    expect(listbox).toHaveAttribute("aria-activedescendant", "note-option-n2");

    await user.keyboard("{ArrowDown}");
    expect(listbox).toHaveAttribute("aria-activedescendant", "note-option-n3");

    await user.keyboard("{Home}");
    // With updated_desc ordering, Beta is first
    expect(listbox).toHaveAttribute("aria-activedescendant", "note-option-n2");

    await user.keyboard("{End}");
    // last should be Alpha (oldest updatedAt)
    expect(listbox).toHaveAttribute("aria-activedescendant", "note-option-n1");
  });
});
