/* AGPL-3.0-or-later */
export function isValidClipRange(start: number, end: number, duration: number): boolean {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(duration) &&
    start >= 0 &&
    end > start &&
    end <= duration
  );
}

export function clipSecondsLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
