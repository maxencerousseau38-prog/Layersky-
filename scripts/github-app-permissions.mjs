#!/usr/bin/env node
/**
 * What the GitHub App asks for, and what the installation actually holds.
 *
 * ## Why this exists as a script
 *
 * There is no API for changing an App's permissions. `PATCH /app` with
 * `default_permissions` answers **404** authenticated as the App — not 403,
 * the endpoint does not exist. Permissions are a form at
 * `https://github.com/settings/apps/layersky-i18n/permissions`, so removing
 * one is a manual step, and the only thing automation can do is tell you
 * whether the step worked.
 *
 * That is worth automating here because the obvious check is the wrong one.
 * `GET /app` reports what the App *asks for*; the installation keeps whatever
 * it was granted. CLAUDE.md records a day lost to exactly that gap: `GET /app`
 * said `checks: write`, the installation said otherwise, and nothing in any
 * log mentioned it. So this prints both and diffs them.
 *
 * `gh api` cannot do it: these routes need a JWT signed with the App's private
 * key, and `gh` authenticates as a user. Hence 40 lines of crypto.
 *
 * ## Use
 *
 *   node scripts/github-app-permissions.mjs
 *
 * Reads `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY_PATH` from `.env` at the
 * repository root. Exits non-zero when the App and the installation disagree,
 * or when a permission this product does not use is still granted — so it can
 * be run as a check rather than read as a report.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Everything this product actually calls, and nothing else.
 *
 * Derived by grep, not by intent: `artifact_metadata` and `codespaces_metadata`
 * appear nowhere in the repository except in prose explaining that they appear
 * nowhere. If a future feature needs one, add it here in the same commit that
 * adds the call, so this script never reports a permission as surplus while
 * something depends on it.
 */
const USED = new Set([
  'checks', // post the i18n check on the commit
  'contents', // read a pull request's files, create a branch, commit
  'metadata', // granted to every App; lists reachable repositories
  'pull_requests', // open the corrective pull request
]);

function env() {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf('=');
        return [
          line.slice(0, at),
          line.slice(at + 1).replace(/^["']|["']$/g, ''),
        ];
      }),
  );
}

function appJwt({ GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PATH }) {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new Error(
      'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH must be set in .env',
    );
  }
  const b64 = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // 60 seconds of backdating, because GitHub rejects a JWT whose `iat` is in
  // the future and clocks drift.
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iat: now - 60,
    exp: now + 540,
    iss: GITHUB_APP_ID,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const key = readFileSync(GITHUB_APP_PRIVATE_KEY_PATH, 'utf8');
  return `${unsigned}.${signer.sign(key).toString('base64url')}`;
}

async function get(path, jwt) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} -> ${response.status}`);
  }
  return await response.json();
}

function surplus(permissions) {
  return Object.keys(permissions ?? {})
    .filter((scope) => !USED.has(scope))
    .sort();
}

async function main() {
  const jwt = appJwt(env());

  const app = await get('/app', jwt);
  const installations = await get('/app/installations', jwt);

  let failed = false;

  const appSurplus = surplus(app.permissions);
  console.log(`App "${app.slug}"`);
  console.log(`  events:      ${(app.events ?? []).join(', ') || '(none)'}`);
  console.log(
    `  permissions: ${Object.entries(app.permissions ?? {})
      .map(([scope, level]) => `${scope}:${level}`)
      .sort()
      .join(' ')}`,
  );
  if (appSurplus.length > 0) {
    console.log(`  SURPLUS:     ${appSurplus.join(', ')}`);
    failed = true;
  }

  for (const installation of installations) {
    const granted = installation.permissions ?? {};
    const installationSurplus = surplus(granted);
    /*
     * The comparison that matters. An App can ask for less than its
     * installations hold: narrowing the form is supposed to apply at once,
     * but a *widening* waits for the owner to accept and leaves the two out
     * of step with nothing anywhere saying so.
     */
    const pending = Object.keys(app.permissions ?? {}).filter(
      (scope) => !(scope in granted),
    );
    const stale = Object.keys(granted).filter(
      (scope) => !(scope in (app.permissions ?? {})),
    );

    console.log(
      `\nInstallation ${installation.id} (${installation.account?.login})`,
    );
    console.log(`  updated_at:  ${installation.updated_at}`);
    console.log(
      `  permissions: ${Object.entries(granted)
        .map(([scope, level]) => `${scope}:${level}`)
        .sort()
        .join(' ')}`,
    );
    for (const scope of USED) {
      if (!(scope in granted)) {
        console.log(`  MISSING:     ${scope} — the product needs this`);
        failed = true;
      }
    }
    if (installationSurplus.length > 0) {
      console.log(`  SURPLUS:     ${installationSurplus.join(', ')}`);
      failed = true;
    }
    if (pending.length > 0) {
      console.log(
        `  PENDING:     ${pending.join(', ')} — the App asks for these and this installation does not hold them. The owner has not accepted.`,
      );
      failed = true;
    }
    if (stale.length > 0) {
      console.log(
        `  STALE:       ${stale.join(', ')} — still granted although the App no longer asks. Narrowing did not propagate.`,
      );
      failed = true;
    }
  }

  console.log(
    failed
      ? '\nFAIL — see above. Permissions are edited at https://github.com/settings/apps/<slug>/permissions; there is no API.'
      : '\nOK — the App asks for exactly what it uses, and every installation holds exactly that.',
  );
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
