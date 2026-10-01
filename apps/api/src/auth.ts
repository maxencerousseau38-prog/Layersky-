import { createHash, timingSafeEqual } from 'node:crypto';
import { isCliToken } from '@localize-infra/schemas';
import type { Context, Next } from 'hono';
import {
  OPERATOR,
  type TokenResolver,
  type WorkspaceCaller,
  hashCliToken,
} from './callers.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Constant-time string equality check. Hashes both inputs to a fixed-length
 * SHA-256 digest first so `timingSafeEqual` (which requires equal-length
 * buffers and throws otherwise) can be used unconditionally, and so the
 * comparison doesn't leak the token's length via a `.length` short-circuit.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = createHash('sha256').update(a).digest();
  const bufB = createHash('sha256').update(b).digest();
  return timingSafeEqual(bufA, bufB);
}

/**
 * Pure check for whether an `Authorization` header value carries the exact
 * expected bearer token. Extracted from the Hono middleware so it can be
 * unit-tested without spinning up the app.
 */
export function isValidBearerToken(
  authHeader: string | null | undefined,
  expectedToken: string,
): boolean {
  if (!authHeader || !expectedToken) return false;
  // The scheme name ("Bearer") is case-insensitive per RFC 7235 section 2.1;
  // only the token value itself (compared below via constantTimeEquals) is
  // case-sensitive.
  const scheme = authHeader.slice(0, BEARER_PREFIX.length).toLowerCase();
  if (scheme !== BEARER_PREFIX.toLowerCase()) return false;
  const token = authHeader.slice(BEARER_PREFIX.length);
  return token.length > 0 && constantTimeEquals(token, expectedToken);
}

/**
 * Hono middleware that rejects any request whose `Authorization` header is
 * not exactly `Bearer <expectedToken>` with a 401 before it reaches the
 * route handler.
 */
export function createAuthMiddleware(expectedToken: string) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!isValidBearerToken(authHeader, expectedToken)) {
      return c.json(
        { error: 'Unauthorized: missing or invalid bearer token' },
        401,
      );
    }
    await next();
  };
}

/**
 * The bearer token, if the header carries one.
 */
function bearerTokenOf(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const scheme = authHeader.slice(0, BEARER_PREFIX.length).toLowerCase();
  if (scheme !== BEARER_PREFIX.toLowerCase()) return null;
  const token = authHeader.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

export interface CallerAuthOptions {
  /** The server-to-server token. Always accepted. */
  operatorToken: string;
  /**
   * Resolves personal `lit_…` tokens. Null when this deployment has no
   * database configured, in which case personal tokens are refused with a
   * reason rather than as if they were wrong.
   */
  resolver: TokenResolver | null;
}

/**
 * Establishes who is calling and stores it on the context as `caller`.
 *
 * Every refusal is a sentence a person can act on, because the CLI prints it
 * as-is. None of them echoes the token.
 */
export function createCallerMiddleware(options: CallerAuthOptions) {
  return async (c: Context, next: Next) => {
    const token = bearerTokenOf(c.req.header('Authorization'));
    if (!token) {
      return c.json(
        { error: 'Unauthorized: missing or invalid bearer token' },
        401,
      );
    }

    if (isValidBearerToken(`Bearer ${token}`, options.operatorToken)) {
      c.set('caller', OPERATOR);
      await next();
      return;
    }

    if (!isCliToken(token)) {
      return c.json(
        { error: 'Unauthorized: missing or invalid bearer token' },
        401,
      );
    }

    if (!options.resolver) {
      return c.json(
        {
          error:
            'Personal CLI tokens are not enabled on this API deployment. Use the token issued for it, or point --api-url at an instance that accepts yours.',
        },
        401,
      );
    }

    let caller: WorkspaceCaller | null;
    try {
      caller = await options.resolver.resolve(hashCliToken(token));
    } catch {
      return c.json(
        {
          error: 'Could not verify the CLI token right now. Try again shortly.',
        },
        503,
      );
    }

    if (!caller) {
      return c.json(
        {
          error:
            // "Layersky web app", not "Localize Infra": this names the
            // product a reader signs in to, not the GitHub App, whose display
            // name really is the old one and is left alone on purpose.
            'This CLI token is invalid, expired or revoked. Create a new one in the Layersky web app, under your workspace’s CLI tokens.',
        },
        401,
      );
    }

    c.set('caller', caller);
    await next();
  };
}
