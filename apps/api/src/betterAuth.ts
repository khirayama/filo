import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { Resend } from "resend";
import type { Env } from "./env";
import { authSchema } from "./auth-schema";

export function createBetterAuth(env: Env) {
  const db = drizzle(env.DB);
  const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  const send = async (to: string, subject: string, url: string) => {
    if (!resend || !env.MAIL_FROM) {
      throw new Error("Authentication email delivery is not configured");
    }
    const result = await resend.emails.send({ from: env.MAIL_FROM, to, subject, text: `${url}\n` });
    if (result.error) {
      console.error(`auth email delivery failed subject=${subject}`, result.error);
      throw result.error;
    }
  };
  const trustedOrigins = [
    ...(env.CORS_ALLOWED_ORIGINS ?? "").split(","),
    ...(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "filo://auth").split(","),
  ].map(value => value.trim()).filter(Boolean);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_PUBLIC_URL,
    trustedOrigins,
    // The Pages deployment is on a different site from the API.  Its
    // credentialed requests need a cross-site session cookie.  Secure cookies
    // are required for SameSite=None in production; local HTTP stays usable.
    advanced: {
      useSecureCookies: env.APP_ENV === "production",
      ...(env.APP_ENV === "production"
        ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true } }
        : {}),
    },
    database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
    plugins: [bearer()],
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    emailAndPassword: {
      enabled: true,
      // Email ownership is not part of the sign-up flow. Resend is used for
      // password reset messages only.
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => { await send(user.email, "Filo password reset", url); },
    },
  });
}
