import { useCallback, useState } from "react";

/** A boolean remembered in localStorage (per-browser UI preference, e.g. sidebar collapsed). */
export function useStoredBoolean(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : raw === "true";
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // ignore: preference just won't persist
      }
    },
    [key],
  );

  return [value, update];
}
