/* AGPL-3.0-or-later */
export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

type CheckoutResponse = { url: string };

export async function startCheckout(): Promise<string> {
  const res = await fetchJson<CheckoutResponse>("/api/checkout", { method: "POST" });
  return res.url;
}

export async function unlockDemo(): Promise<void> {
  await fetchJson<{ ok: true }>("/api/demo/unlock", { method: "POST" });
}
