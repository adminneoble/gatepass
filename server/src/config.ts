const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  /** Postgres connection string (Supabase). Without it, local dev uses PGlite in `pgliteDir`. */
  databaseUrl: env.DATABASE_URL ?? '',
  pgliteDir: env.PGLITE_DIR ?? '.pglite',
  /**
   * Public origin used in SMS links and QR codes. When PUBLIC_URL is unset it is learned from
   * the first browser request (see app.ts), so a Vercel deployment needs no configuration.
   */
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  publicUrlFixed: !!env.PUBLIC_URL,
  /** HMAC secret for pass tokens and realtime channel names. Loaded from app_settings when unset (see bootstrap.ts). */
  secret: env.GATEPASS_SECRET ?? '',
  isProd: env.NODE_ENV === 'production',
  /** Show OTPs on screen, enable the /dev/sms inbox and the demo reset. On outside production; GATEPASS_DEMO=1 forces it on. */
  demo: env.NODE_ENV !== 'production' || env.GATEPASS_DEMO === '1',
  /** Society-local timezone for "today" and activity ranges. */
  timeZone: env.SOCIETY_TZ ?? 'Asia/Kolkata',
  /** SMS sender id shown to recipients. */
  smsSender: env.SMS_SENDER ?? 'PG-GATE',
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
};
