/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { clipSecondsLabel, isValidClipRange } from "@/lib/clip";

describe("isValidClipRange", () => {
  it("accepts a range inside the duration", () => {
    expect(isValidClipRange(0, 5, 10)).toBe(true);
    expect(isValidClipRange(2, 10, 10)).toBe(true);
  });
  it("rejects end <= start", () => {
    expect(isValidClipRange(5, 5, 10)).toBe(false);
    expect(isValidClipRange(6, 5, 10)).toBe(false);
  });
  it("rejects end beyond duration and negative start", () => {
    expect(isValidClipRange(0, 15, 10)).toBe(false);
    expect(isValidClipRange(-1, 5, 10)).toBe(false);
  });
});

describe("clipSecondsLabel", () => {
  it("formats m:ss", () => {
    expect(clipSecondsLabel(0)).toBe("0:00");
    expect(clipSecondsLabel(9)).toBe("0:09");
    expect(clipSecondsLabel(75)).toBe("1:15");
  });
});
