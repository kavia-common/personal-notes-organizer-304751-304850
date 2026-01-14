/**
 * Lightweight API client placeholder.
 * This app currently runs fully offline; this client is ready to be swapped in once a backend exists.
 */

const API_BASE =
  (process.env.REACT_APP_API_BASE && process.env.REACT_APP_API_BASE.trim()) ||
  (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.trim()) ||
  "";

// PUBLIC_INTERFACE
export function getApiBaseUrl() {
  /** Returns the configured API base URL (may be empty string if unset). */
  return API_BASE;
}

async function safeFetch(path, options = {}) {
  if (!API_BASE) return null;
  const url = `${API_BASE.replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`API request failed (${res.status}): ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  // Try JSON; fallback to text
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

// PUBLIC_INTERFACE
export const apiClient = {
  /** Placeholder list endpoint (returns null offline). */
  async listNotes() {
    return safeFetch("/notes", { method: "GET" });
  },

  /** Placeholder create endpoint (returns null offline). */
  async createNote(note) {
    return safeFetch("/notes", { method: "POST", body: JSON.stringify(note) });
  },

  /** Placeholder update endpoint (returns null offline). */
  async updateNote(id, patch) {
    return safeFetch(`/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  /** Placeholder delete endpoint (returns null offline). */
  async deleteNote(id) {
    return safeFetch(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
