/** Client-side persistence for an in-flight generate run across navigations. */

export type PersistedActiveRun = {
  slug: string;
  scope: {
    name: string;
    scope_level: "working" | "deep" | "exam-ready";
    scope_description: string;
    include: string[];
    exclude: string[];
    summary: string;
    outline?: Array<{
      section: string;
      in?: string;
      out?: string;
      subsections?: string[];
    }>;
  };
  savedAt: number;
};

const STORAGE_KEY = "lattice.activeGenerateRun";

export function readActiveRun(): PersistedActiveRun | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedActiveRun;
    if (!parsed?.slug || !parsed?.scope?.name || !parsed?.scope?.scope_description) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeActiveRun(run: PersistedActiveRun): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...run, savedAt: Date.now() })
    );
  } catch {
    // Quota / private mode — live reconnect just won't survive a refresh.
  }
}

export function clearActiveRun(slug?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (slug) {
      const current = readActiveRun();
      if (current && current.slug !== slug) return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
