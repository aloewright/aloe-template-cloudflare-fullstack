/* AGPL-3.0-or-later */
import { betterAuth } from "better-auth";
import { sendEmail } from "./lib/email";

type Env = { DB: D1Database; EMAIL: SendEmail; EMAIL_FROM: string };

export function createAuth(env: Env) {
  return betterAuth({
    appName: "Warp Template Cloudflare Fullstack",
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      // Native CF send: arbitrary recipients require an onboarded sending
      // domain (see README); until then only verified destinations receive.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your password",
          html: `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your email",
          html: `<p>Confirm your email:</p><p><a href="${url}">${url}</a></p>`,
        });
      },
    },
  });
}
