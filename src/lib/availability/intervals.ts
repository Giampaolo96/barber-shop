// Intervalli semiaperti [start, end) su istanti assoluti.

export type Interval = { start: Date; end: Date };

/** Intervalli ordinati, con quelli sovrapposti o contigui fusi; scarta quelli vuoti. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.start < i.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Interval[] = [];
  for (const { start, end } of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      if (end > last.end) last.end = end;
    } else {
      merged.push({ start, end });
    }
  }
  return merged;
}

/** Parti di `from` non coperte da `remove`. */
export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  const holes = mergeIntervals(remove);
  const result: Interval[] = [];
  for (const interval of mergeIntervals(from)) {
    let cursor = interval.start;
    for (const hole of holes) {
      if (hole.end <= cursor) continue;
      if (hole.start >= interval.end) break;
      if (hole.start > cursor) result.push({ start: cursor, end: hole.start });
      if (hole.end > cursor) cursor = hole.end;
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}
