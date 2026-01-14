import React, { useEffect } from "react";
import styles from "./Toast.module.css";
import { useNotes } from "../store/NotesStore";

// PUBLIC_INTERFACE
export default function Toast() {
  /** Global toast/snackbar that shows store-driven messages and optional single action (e.g., Undo). */
  const { derived, actions } = useNotes();
  const toast = derived.toast;

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => actions.clearToast(toast.id), 5200);
    return () => window.clearTimeout(t);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;

  return (
    <div className={styles.wrap} role="status" aria-live="polite" aria-label="Notification">
      <div className={`${styles.toast} ocean-surface`}>
        <div className={styles.msg}>{toast.message}</div>
        <div className={styles.actions}>
          {toast.actionLabel ? (
            <button
              type="button"
              className={`ocean-btn ${styles.actionBtn}`}
              onClick={() => {
                if (toast.actionKey === "UNDO_DELETE") actions.undoDelete();
                actions.clearToast(toast.id);
              }}
              aria-label={toast.actionLabel}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`ocean-btn ${styles.closeBtn}`}
            onClick={() => actions.clearToast(toast.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
