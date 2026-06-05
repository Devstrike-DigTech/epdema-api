import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, magicLink, organization, twoFactor, haveIBeenPwned } from 'better-auth/plugins';
import { PrismaClient } from '@prisma/client';

import { sendPasswordResetEmail } from '../notifications/password-reset.template';
import { sendVerificationEmail } from '../notifications/verify-email.template';

// Standalone Prisma client for Better Auth — separate from NestJS PrismaService
// because Better Auth instantiates outside the NestJS DI container.
const prisma = new PrismaClient();

const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
// Only the local docker/dev box runs over http on a same-site origin
// (localhost). Every deployed environment (staging + production) is https with
// the web app on a different domain, so the session cookie must be Secure +
// SameSite=None to be sent cross-site.
const isLocal = (process.env.NODE_ENV ?? 'development') === 'development';

/**
 * Better Auth bakes the client-supplied `callbackURL` into verification and
 * password-reset links as a query param, then — on the API host — redirects to
 * it verbatim once the token is consumed. When the client passes a *relative*
 * path (e.g. `/dashboard`), that redirect resolves against the API origin
 * (:3001) and 404s ("Cannot GET /dashboard"). Rewriting any relative
 * `callbackURL` to an absolute web-origin URL makes the post-action redirect
 * land on the web app. Already-absolute callbackURLs pass through unchanged.
 */
function absolutizeCallbackURL(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const cb = u.searchParams.get('callbackURL');
    if (cb && cb.startsWith('/')) {
      u.searchParams.set('callbackURL', new URL(cb, webOrigin).toString());
    }
    return u.toString();
  } catch {
    // Not an absolute URL we can parse — leave it untouched.
    return rawUrl;
  }
}

/**
 * Build the `socialProviders` block, omitting any provider that's missing
 * credentials. Better Auth's `socialProviders` is validated at startup —
 * an empty `clientId` would throw, so we only include the keys when their
 * env pairs are populated.
 *
 * Setup notes:
 *   - **Google**: free. Cloud Console → "APIs & Services" → "Credentials" →
 *     "Create OAuth client ID" (Web app). Authorized redirect URI:
 *     `http://localhost:3001/api/auth/callback/google` for dev.
 *   - **Apple**: paid (Apple Developer Program). Identifiers → create a
 *     Services ID (e.g. `com.epdema.signin`) → enable Sign in with Apple →
 *     configure return URL `http://localhost:3001/api/auth/callback/apple`.
 *     Create a Key with "Sign in with Apple" → download the `.p8` file →
 *     paste its contents (with newlines) into `APPLE_PRIVATE_KEY`.
 */
function buildSocialProviders() {
  const out: Record<string, unknown> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    out.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }
  if (
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  ) {
    out.apple = {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_PRIVATE_KEY,
      // Better Auth's Apple provider takes the private key as the "secret"
      // and the keyId + teamId via extra fields when wired manually.
      // For now we set them via the Apple-provider object — see Better Auth
      // docs `https://www.better-auth.com/docs/authentication/apple`.
      keyId: process.env.APPLE_KEY_ID,
      teamId: process.env.APPLE_TEAM_ID,
    };
  }
  return out;
}

/**
 * Better Auth instance.
 *
 * Mounted on the Express adapter at /api/auth/* in main.ts.
 * Routes:
 *   POST /api/auth/sign-up/email
 *   POST /api/auth/sign-in/email
 *   POST /api/auth/sign-out
 *   GET  /api/auth/get-session
 *   GET  /api/auth/sign-in/social?provider=google
 *   GET  /api/auth/callback/google
 *   GET  /api/auth/sign-in/social?provider=apple
 *   GET  /api/auth/callback/apple
 *   POST /api/auth/sign-in/magic-link
 *   POST /api/auth/forgot-password
 *   POST /api/auth/reset-password
 *   POST /api/auth/send-verification-email
 *   GET  /api/auth/verify-email?token=…
 *   ...full list at https://www.better-auth.com/docs
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // Phase 5.7·C — always require verification before allowing sign-in.
    // Earlier the dev shortcut left this off; a beta tester signing up
    // would skip the email round-trip and never realise verification
    // wasn't tested. Now both dev + prod hit the same code path.
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ email: user.email, resetUrl: absolutizeCallbackURL(url) });
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ email: user.email, verificationUrl: absolutizeCallbackURL(url) });
    },
    autoSignInAfterVerification: true,
    sendOnSignUp: true,
    expiresIn: 24 * 60 * 60, // 24 hours
  },

  socialProviders: buildSocialProviders(),

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh idle sessions daily
    cookieCache: {
      enabled: true,
      maxAge: 60, // 1-min cookie cache to avoid hitting DB on every request
    },
  },

  advanced: {
    cookies: {
      sessionToken: {
        attributes: {
          httpOnly: true,
          secure: !isLocal,
          sameSite: isLocal ? 'lax' : 'none',
        },
      },
    },
  },

  trustedOrigins: [webOrigin],

  // Phase 5.7·F — Better Auth's own rate limiter, sized for private beta.
  // These routes mount on Express BEFORE the NestJS `ThrottlerGuard` can
  // see them, so the 60/min global cap in `AppModule` doesn't apply here.
  // Caps are intentionally tight on the sign-in / sign-up / forget-password
  // surfaces — those are the brute-force + email-spam targets.
  //
  // `storage: 'memory'` is fine while we run a single api replica; flip to
  // 'database' (Better Auth's Prisma-backed bucket) once we go multi-pod.
  rateLimit: {
    enabled: true,
    window: 60, // seconds — baseline bucket
    max: 30, // per IP, per minute, across all auth routes (fallback)
    storage: 'memory',
    customRules: {
      // Brute-force protection — 5 attempts/min per IP is plenty for a real
      // user fat-fingering their password and not enough to feasibly try a
      // password list.
      '/sign-in/email': { window: 60, max: 5 },
      // Email-spam protection — 3 signups/hour from one IP catches almost
      // every legitimate use case (re-trying after sign-up validation
      // errors) while killing botnet sign-ups.
      '/sign-up/email': { window: 60 * 60, max: 3 },
      // Forget-password — 3/hour. Sending the email is cheap on Resend but
      // a flood would still mark our domain as spammy.
      '/request-password-reset': { window: 60 * 60, max: 3 },
      '/forget-password': { window: 60 * 60, max: 3 }, // legacy alias
      // Resend verification email — 3/hour. Same email-spam concern.
      '/send-verification-email': { window: 60 * 60, max: 3 },
      // Magic link — 3/hour per IP. Unused today but covered.
      '/sign-in/magic-link': { window: 60 * 60, max: 3 },
    },
  },

  plugins: [
    bearer(), // Authorization: Bearer <token> for Flutter
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // TODO(Phase 4): wire to Resend
        // eslint-disable-next-line no-console
        console.log(`[dev magic-link] ${email} → ${url}`);
      },
    }),
    organization(), // planning teams scaffold
    twoFactor(), // optional 2FA for all, mandatory for admins (enforced in app logic)
    haveIBeenPwned({ customPasswordCompromisedMessage: 'This password has been seen in a public breach. Pick another.' }),
  ],
});

export type Session = typeof auth.$Infer.Session;
