/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { buildDeliveryUrl, buildOptionsString, parseAccountHash } from "@/lib/transform";

describe("buildOptionsString", () => {
  it("returns empty string when nothing is set", () => {
    expect(buildOptionsString({})).toBe("");
  });
  it("emits set keys in a stable order", () => {
    expect(
      buildOptionsString({ width: 800, height: 600, fit: "cover", quality: 80, format: "auto" }),
    ).toBe("width=800,height=600,fit=cover,format=auto,quality=80");
  });
  it("url-encodes background and formats booleans + decimals", () => {
    expect(buildOptionsString({ background: "#ffffff", anim: false, brightness: 1.2 })).toBe(
      "background=%23ffffff,brightness=1.2,anim=false",
    );
  });
});

describe("parseAccountHash", () => {
  it("extracts the hash from a delivery URL", () => {
    expect(parseAccountHash("https://imagedelivery.net/ABC123/img-1/public")).toBe("ABC123");
  });
  it("returns null for a non-delivery URL", () => {
    expect(parseAccountHash("https://example.com/x")).toBeNull();
  });
});

describe("buildDeliveryUrl", () => {
  it("omits the options segment when empty", () => {
    expect(buildDeliveryUrl("ABC", "img1", "")).toBe("https://imagedelivery.net/ABC/img1");
  });
  it("appends options when present", () => {
    expect(buildDeliveryUrl("ABC", "img1", "width=800,fit=cover")).toBe(
      "https://imagedelivery.net/ABC/img1/width=800,fit=cover",
    );
  });
});
