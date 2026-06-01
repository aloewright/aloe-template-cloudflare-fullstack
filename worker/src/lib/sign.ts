/* AGPL-3.0-or-later */
// Generates a signed Cloudflare Images delivery URL (HMAC-SHA256 over the
// path + query), required to view images uploaded with requireSignedURLs.
// Algorithm per Cloudflare Images "serve private images" docs.
export async function signImageUrl(
  rawUrl: string,
  signingKey: string,
  expSeconds: number,
  nowSeconds: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const url = new URL(rawUrl);
  url.searchParams.set("exp", String(nowSeconds + expSeconds));
  const stringToSign = `${url.pathname}?${url.searchParams.toString()}`;
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(stringToSign));
  const sig = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  url.searchParams.set("sig", sig);
  return url.toString();
}
