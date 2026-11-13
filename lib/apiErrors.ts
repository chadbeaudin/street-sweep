import { NextResponse } from 'next/server';

// An error whose message was written for the user, with no upstream or
// internal detail in it, so API routes may show it as-is (#196).
export class UserFacingError extends Error {}

// Logs the full error server-side and answers with `fallback`, unless the
// error was written for the user.
export function errorResponse(error: unknown, logLabel: string, fallback: string, status = 500, extra: Record<string, unknown> = {}) {
    console.error(logLabel, error);
    const message = error instanceof UserFacingError ? error.message : fallback;
    return NextResponse.json({ error: message, ...extra }, { status });
}
