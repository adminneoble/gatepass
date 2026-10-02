const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  dbFile: env.DATABASE_FILE ?? 'gatepass.db',
  /** Public origin used in SMS links and QR codes. */
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** HMAC secret for pass tokens. Must be set in production so QR codes survive restarts. */
  secret: env.GATEPASS_SECRET ?? (env.NODE_ENV === 'production' ? '' : 'dev-only-gatepass-secret'),
  isProd: env.NODE_ENV === 'production',
  /** Society-local timezone for "today" and activity ranges. */
  timeZone: env.SOCIETY_TZ ?? 'Asia/Kolkata',
  /** SMS sender id shown to recipients. */
  smsSender: env.SMS_SENDER ?? 'PG-GATE',
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
};

if (config.isProd && !config.secret) throw new Error('GATEPASS_SECRET must be set in production');
