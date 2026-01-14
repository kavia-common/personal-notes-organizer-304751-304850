import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const [sidebarOpenMobile, setSidebarOpenMobile] = useState(false);
  const sidebarToggleRef = useRef(null);

  const sidebarRegionId = "sidebar-region";

  const sidebarToggleLabel = useMemo(
    () => (sidebarOpenMobile ? "Hide filters sidebar" : "Show filters sidebar"),
    [sidebarOpenMobile]
  );

  // Close sidebar on escape when open in overlay mode.
  useEffect(() => {
    if (!sidebarOpenMobile) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setSidebarOpenMobile(false);
        // Return focus to the toggle for a predictable flow.
        window.setTimeout(() => sidebarToggleRef.current?.focus(), 0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpenMobile]);

  return (
    <NotesProvider>
      <div className={`ocean-app ${styles.shell}`}>
        <header className={styles.top}>
          <TopNav />
        </header>

        <div className={styles.mobileControls} aria-label="Mobile controls">
          <button
            ref={sidebarToggleRef}
            className={`ocean-btn ${styles.sidebarToggle}`}
            type="button"
            aria-label={sidebarToggleLabel}
            aria-controls={sidebarRegionId}
            aria-expanded={sidebarOpenMobile}
            onClick={() => setSidebarOpenMobile((v) => !v)}
          >
            {sidebarOpenMobile ? "Hide filters" : "Show filters"}
          </button>
        </div>

        {/* Primary app layout */}
        <main className={styles.body} aria-label="Notes application">
          <aside
            id={sidebarRegionId}
            className={`${styles.sidebar} ${styles.panel} ${sidebarOpenMobile ? styles.sidebarOpenMobile : ""}`}
            aria-label="Category sidebar"
          >
            <Sidebar
              onRequestCloseMobile={() => {
                setSidebarOpenMobile(false);
                window.setTimeout(() => sidebarToggleRef.current?.focus(), 0);
              }}
            />
          </aside>

          <section className={`${styles.list} ${styles.panel}`} aria-label="Notes panel">
            <NotesList />
          </section>

          <section className={`${styles.editor} ${styles.panel}`} aria-label="Editor panel">
            <NoteEditor />
          </section>
        </main>

        {/* Backdrop for mobile sidebar overlay */}
        {sidebarOpenMobile ? (
          <button
            type="button"
            className={styles.sidebarBackdrop}
            aria-label="Close filters sidebar"
            onClick={() => {
              setSidebarOpenMobile(false);
              window.setTimeout(() => sidebarToggleRef.current?.focus(), 0);
            }}
          />
        ) : null}

        <Toast />
      </div>
    </NotesProvider>
  );
}

export default App;
