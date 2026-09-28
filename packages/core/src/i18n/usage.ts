import { relative } from 'node:path';
import { Project, type SourceFile, SyntaxKind } from 'ts-morph';

/**
 * Which translation keys the source code actually asks for.
 *
 * ## The inverse of what this package already did
 *
 * `extract/index.ts` walks for hardcoded UI text and uses
 * `isInsideTranslationCall` to **skip** anything already wrapped in `t(…)`.
 * That is right for an application being internationalised for the first time.
 *
 * An application that is *already* internationalised needs the opposite
 * question answered: which keys does the code call, and does the catalogue have
 * them? Same ts-morph walk, opposite polarity — so this lives beside that file
 * rather than reimplementing a traversal.
 *
 * ## Only literal keys, and that is a stated limit rather than an oversight
 *
 * `t('checkout.submit')` is collected. `t(someVariable)` and
 * `t(\`item.${id}\`)` are not, because their value is not knowable without
 * running the program. Reporting a computed key as missing would be a false
 * positive on every dynamic catalogue in existence, and a guardrail that cries
 * wolf is turned off within a week.
 *
 * They are counted instead: `dynamicCallSites` is how many were seen, so a
 * report can say what it could not look at rather than implying it looked at
 * everything. That number is the honest denominator for every claim made from
 * this data.
 */

/** One place the code asks for a key. */
export interface KeyUsage {
  key: string;
  /** Repository-relative, forward slashes on every platform. */
  filePath: string;
  /** 1-indexed, so it matches what an editor and a diff both show. */
  line: number;
}

export interface UsageScan {
  usages: KeyUsage[];
  /**
   * Calls whose key could not be read statically.
   *
   * Not a failure and not a finding — a limit. See the note above on why a
   * computed key is never reported as missing.
   */
  dynamicCallSites: number;
}

/**
 * The call names treated as translation lookups.
 *
 * Deliberately the same shape as `extract/index.ts`'s
 * `TRANSLATION_CALL_NAME_PATTERN`, and deliberately a separate constant: that
 * one decides what to *ignore* while extracting, this one decides what to
 * *collect*. Tying them together would mean a change made for one purpose
 * silently altering the other.
 *
 * `t` and `i18n.t` cover i18next and next-intl; `formatMessage` covers
 * react-intl's imperative API. Matched on the last segment, so `i18n.t`,
 * `intl.formatMessage` and a bare `t` all land.
 */
const LOOKUP_NAMES = new Set(['t', 'translate', 'formatMessage']);

/** `t('a.b')` — the first argument, when it is a plain string literal. */
function literalKeyArgument(
  call: ReturnType<SourceFile['getFirstDescendantByKind']>,
): string | null {
  if (!call) return null;
  const node = call.asKind(SyntaxKind.CallExpression);
  if (!node) return null;
  const first = node.getArguments()[0];
  if (!first) return null;

  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
  }
  /*
   * A template literal with no substitutions is a string that happens to be
   * written with backticks — `t(`checkout.submit`)`. Reading it is not
   * cleverness, it is refusing to report a false "dynamic" for something fully
   * known at rest. One *with* substitutions stays dynamic.
   */
  if (first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return first
      .asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral)
      .getLiteralValue();
  }
  return null;
}

function scanSourceFile(sourceFile: SourceFile, rootDir: string): UsageScan {
  const usages: KeyUsage[] = [];
  let dynamicCallSites = 0;
  const filePath = relative(rootDir, sourceFile.getFilePath()).replace(
    /\\/g,
    '/',
  );

  sourceFile.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node.asKindOrThrow(SyntaxKind.CallExpression);

    // Last segment, so `t`, `i18n.t` and `intl.formatMessage` all match while
    // an unrelated `format(…)` does not.
    const callee = call.getExpression().getText().split('.').pop() ?? '';
    if (!LOOKUP_NAMES.has(callee)) return;

    const key = literalKeyArgument(call);
    if (key === null) {
      dynamicCallSites += 1;
      return;
    }
    // An empty key is a bug in the caller, not a catalogue entry to look for.
    if (key.trim() === '') return;

    usages.push({
      key,
      filePath,
      line: sourceFile.getLineAndColumnAtPos(call.getStart()).line,
    });
  });

  return { usages, dynamicCallSites };
}

/**
 * Scan a set of files for translation lookups.
 *
 * Takes explicit file paths rather than globs, because the caller that matters
 * knows exactly which files a pull request touched. Scanning a whole repository
 * to report on three changed files would be slower and would surface findings
 * the author did not cause — which is the fastest way to make a check
 * ignorable.
 */
export function scanKeyUsage(
  rootDir: string,
  filePaths: readonly string[],
): UsageScan {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
  });

  const usages: KeyUsage[] = [];
  let dynamicCallSites = 0;

  for (const path of filePaths) {
    /*
     * A file that cannot be added is skipped rather than fatal. The list comes
     * from a pull request, which can name a file that was deleted in a later
     * commit, or one this checkout does not carry. Failing the whole analysis
     * over one absent path would turn a routine race into a red check.
     */
    let sourceFile: SourceFile | undefined;
    try {
      sourceFile = project.addSourceFileAtPathIfExists(`${rootDir}/${path}`);
    } catch {
      sourceFile = undefined;
    }
    if (!sourceFile) continue;

    const scan = scanSourceFile(sourceFile, rootDir);
    usages.push(...scan.usages);
    dynamicCallSites += scan.dynamicCallSites;
  }

  return { usages, dynamicCallSites };
}

/** The distinct keys a scan found, in first-seen order. */
export function distinctKeys(scan: UsageScan): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const usage of scan.usages) {
    if (seen.has(usage.key)) continue;
    seen.add(usage.key);
    keys.push(usage.key);
  }
  return keys;
}
