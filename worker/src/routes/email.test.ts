/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv, Bindings } from "../types";
import { sendEmail } from "../lib/email";
import { emailRoute } from "./email";

function fakeEmail() {
  const send = vi.fn(async (_msg: unknown) => ({ messageId: "test-message-id" }));
  return { EMAIL: { send } as unknown as SendEmail, send };
}

describe("sendEmail helper", () => {
  it("defaults from to EMAIL_FROM and derives a text part from html", async () => {
    const { EMAIL, send } = fakeEmail();
    const res = await sendEmail(
      { EMAIL, EMAIL_FROM: "noreply@test.dev" },
      { to: "a@b.com", subject: "Hi", html: "<p>Hello <b>world</b></p>" },
    );
    expect(res).toEqual({ messageId: "test-message-id" });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.from).toBe("noreply@test.dev");
    expect(arg.to).toBe("a@b.com");
    expect(arg.text).toBe("Hello world");
  });

  it("respects an explicit from and text and leaves html unset", async () => {
    const { EMAIL, send } = fakeEmail();
    await sendEmail(
      { EMAIL, EMAIL_FROM: "noreply@test.dev" },
      { to: "a@b.com", subject: "Hi", text: "plain", from: "ops@test.dev" },
    );
    const arg = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.from).toBe("ops@test.dev");
    expect(arg.text).toBe("plain");
    expect(arg.html).toBeUndefined();
  });

  it("throws when neither html nor text is provided", async () => {
    const { EMAIL } = fakeEmail();
    await expect(
      sendEmail({ EMAIL, EMAIL_FROM: "x@test.dev" }, { to: "a@b.com", subject: "Hi" }),
    ).rejects.toThrow(/html.*text|text.*html/i);
  });

  it("drops style/script blocks and decodes entities in the text fallback", async () => {
    const { EMAIL, send } = fakeEmail();
    await sendEmail(
      { EMAIL, EMAIL_FROM: "noreply@test.dev" },
      {
        to: "a@b.com",
        subject: "Hi",
        html: "<style>.x{color:red}</style><p>Tom &amp; Jerry</p><script>alert(1)</script>",
      },
    );
    const arg = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.text).toBe("Tom & Jerry");
  });

  it("throws when no from address can be resolved", async () => {
    const { EMAIL } = fakeEmail();
    await expect(
      sendEmail({ EMAIL, EMAIL_FROM: "" }, { to: "a@b.com", subject: "Hi", text: "x" }),
    ).rejects.toThrow(/from/i);
  });
});

function makeApp(env: Pick<Bindings, "EMAIL" | "EMAIL_FROM">, operator = "operator@example.com") {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => {
    c.set("email", operator);
    return next();
  });
  a.route("/api/email", emailRoute);
  return {
    request: (path: string, init?: RequestInit) => a.request(path, init, env as never),
  };
}

describe("POST /api/email/test", () => {
  it("sends to the authenticated operator and returns the messageId", async () => {
    const { EMAIL, send } = fakeEmail();
    const { request } = makeApp({ EMAIL, EMAIL_FROM: "noreply@test.dev" }, "me@example.com");
    const res = await request("/api/email/test", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      to: "me@example.com",
      messageId: "test-message-id",
    });
    const arg = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.to).toBe("me@example.com");
    expect(arg.from).toBe("noreply@test.dev");
  });

  it("surfaces a 500 when sendEmail throws", async () => {
    const send = vi.fn(async () => {
      throw new Error("send failure");
    });
    const { request } = makeApp(
      { EMAIL: { send } as unknown as SendEmail, EMAIL_FROM: "noreply@test.dev" },
      "me@example.com",
    );
    const res = await request("/api/email/test", { method: "POST" });
    expect(res.status).toBe(500);
  });
});
