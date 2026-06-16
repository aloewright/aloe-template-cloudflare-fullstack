/* AGPL-3.0-or-later */
import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "../lib/email";

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
});
