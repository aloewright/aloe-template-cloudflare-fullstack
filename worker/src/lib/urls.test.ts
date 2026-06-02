/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import {
  parseAccountHash,
  parseStreamCode,
  pickImageThumbnail,
  sanitizeDownloadFilename,
  streamIframeUrl,
} from "./urls";

describe("urls", () => {
  it("parses the account hash from a delivery URL", () => {
    expect(
      parseAccountHash("https://imagedelivery.net/ZWd9g1K7eljCn_KDTu_MWA/abc-123/public"),
    ).toBe("ZWd9g1K7eljCn_KDTu_MWA");
    expect(parseAccountHash("not a url")).toBeNull();
  });

  it("parses the stream customer code", () => {
    expect(
      parseStreamCode(
        "https://customer-f33zs165nr7gyfy4.cloudflarestream.com/uid/thumbnails/thumbnail.jpg",
      ),
    ).toBe("f33zs165nr7gyfy4");
    expect(parseStreamCode("https://example.com")).toBeNull();
  });

  it("prefers the public variant for thumbnails", () => {
    expect(pickImageThumbnail(["https://x/a/w=99", "https://x/a/public"])).toBe(
      "https://x/a/public",
    );
    expect(pickImageThumbnail(["https://x/a/thumb"])).toBe("https://x/a/thumb");
    expect(pickImageThumbnail([])).toBe("");
  });

  it("builds a stream iframe URL", () => {
    expect(streamIframeUrl("code1", "uid1")).toBe(
      "https://customer-code1.cloudflarestream.com/uid1/iframe",
    );
  });

  it("sanitizes download filenames", () => {
    expect(sanitizeDownloadFilename("My Vid.mp4")).toBe("My_Vid");
    expect(sanitizeDownloadFilename("a/b c.mov")).toBe("a_b_c");
    expect(sanitizeDownloadFilename("clip-01_final.webm")).toBe("clip-01_final");
    expect(sanitizeDownloadFilename("")).toBe("video");
    expect(sanitizeDownloadFilename("***")).toBe("video");
  });
});
