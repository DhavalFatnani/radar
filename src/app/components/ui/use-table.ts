"use client";
import { useMemo, useState } from "react";

export function useSort<T>(rows: T[], initialKey: keyof T & string, initialDir: 1 | -1 = 1) {
  const [sortKey, setSortKey] = useState<keyof T & string>(initialKey);
  const [sortDir, setSortDir] = useState<1 | -1>(initialDir);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "string" && typeof y === "string") return x.localeCompare(y) * sortDir;
      return ((x as number) - (y as number)) * sortDir;
    });
  }, [rows, sortKey, sortDir]);
  function toggle(key: keyof T & string) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }
  return { sorted, sortKey, sortDir, toggle };
}

export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allChecked = ids.length > 0 && ids.every((id) => selected.has(id));
  function toggleAll() { setSelected(allChecked ? new Set() : new Set(ids)); }
  return { selected, toggle, toggleAll, allChecked };
}
