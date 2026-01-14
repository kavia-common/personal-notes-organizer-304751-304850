import React from "react";
import "./theme.css";
import styles from "./App.module.css";
import { NotesProvider } from "./store/NotesStore";
import TopNav from "./components/TopNav";
import Sidebar from "./components/Sidebar";
import NotesList from "./components/NotesList";
import NoteEditor from "./components/NoteEditor";
import Toast from "./components/Toast";

// PUBLIC_INTERFACE
function App() {
  /** Main app entry for the personal notes organizer UI. */
  return (
    <NotesProvider>
      <div className={`ocean-app ${styles.shell}`}>
        <div className={styles.top}>
          <TopNav />
        </div>

        <main className={styles.body} aria-label="Notes application">
          <div className={`${styles.sidebar} ${styles.panel}`} aria-label="Category sidebar">
            <Sidebar />
          </div>

          <div className={`${styles.list} ${styles.panel}`} aria-label="Notes panel">
            <NotesList />
          </div>

          <div className={`${styles.editor} ${styles.panel}`} aria-label="Editor panel">
            <NoteEditor />
          </div>
        </main>

        <Toast />
      </div>
    </NotesProvider>
  );
}

export default App;
