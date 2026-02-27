import * as fs from 'fs';
import * as path from 'path';

/**
 * Structured payload for error tracking services like Sentry.
 */
export interface LogPayload {
  context: string;
  message: string;
  stack?: string;
  timestamp: string;
  environment: string;
  metadata?: Record<string, any>;
}

/**
 * Appends detailed error information to a hidden log file.
 * Optionally forwards it to an external observability tool like Sentry.
 */
export function logInternalError(context: string, error: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const env = process.env.NODE_ENV || 'development';

    // 1. Construct a standardized payload
    const payload: LogPayload = {
      context,
      message: error instanceof Error ? error.message : String(error),
      timestamp,
      environment: env,
    };

    if (error instanceof Error) {
      payload.stack = error.stack;
      payload.metadata = {};
      if ('stdout' in error && (error as any).stdout) {
        payload.metadata.stdout = (error as any).stdout;
      }
      if ('stderr' in error && (error as any).stderr) {
        payload.metadata.stderr = (error as any).stderr;
      }
    } else if (typeof error === 'object' && error !== null) {
      payload.metadata = { rawErrorObject: error };
    }

    // 2. Always write to the local file (both dev and prod)
    logToFile(payload);

    // 3. Opt-in: Dispatch to an external tracking service if configured
    // Example: Only send to Sentry if we are in production and have a DSN
    // if (env === 'production' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
    //   logToExternalService(payload, error);
    // }

  } catch (e) {
    // Failsafe: if the logging itself fails, don't crash the application
  }
}

/**
 * File Transport: Write to local appended text file.
 * In development, this is `.error-logs.txt`. In production, this drops to `.error-logs-prod.txt`.
 */
function logToFile(payload: LogPayload) {
  const fileName = payload.environment === 'production' ? '.error-logs-prod.txt' : '.error-logs.txt';
  const logFilePath = path.join(process.cwd(), fileName);
  
  let details = `${payload.message}\n${payload.stack || ''}`;
  if (payload.metadata) {
    details += `\nMETADATA:\n${JSON.stringify(payload.metadata, null, 2)}`;
  }
  
  const banner = `\n=========================================\n[${payload.timestamp}] ERROR IN: ${payload.context} (${payload.environment})\n=========================================\n`;
  const finalLog = `${banner}${details}\n`;
  
  fs.appendFileSync(logFilePath, finalLog, 'utf8');
}

/**
 * External Transport: Formats for tools like Sentry, Datadog, etc.
 */
function logToExternalService(payload: LogPayload, originalError: unknown) {
  // TODO: Implement external tracking integration here.
  // Example for Sentry:
  // import * as Sentry from '@sentry/nextjs';
  // Sentry.captureException(originalError, {
  //   tags: { context: payload.context, environment: payload.environment },
  //   extra: payload.metadata
  // });
}
