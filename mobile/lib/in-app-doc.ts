import { useSyncExternalStore } from "react";

/**
 * One in-app document viewer for the whole app (invoices, receipts).
 * Call openInAppDoc(url, title) from anywhere; <GlobalDocViewer /> in the root layout shows it.
 */
type Doc = { url: string; title: string } | null;

let current: Doc = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openInAppDoc(url: string, title: string) {
  current = { url, title };
  emit();
}

export function closeInAppDoc() {
  current = null;
  emit();
}

export function useInAppDoc() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current
  );
}
