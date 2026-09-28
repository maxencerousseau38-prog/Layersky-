import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Which i18n library a project uses, which is not which framework it builds
 * with.
 *
 * `detect/index.ts` answers "Next.js, Vite + React or React Native" — the build
 * framework, which decides where source lives and how it compiles. That is the
 * question an application being internationalised for the first time needs.
 *
 * An application that already has translations needs a different one: which
 * library reads the catalogues, because that decides where the catalogues are
 * and what a placeholder looks like. A Next.js app might use next-intl or
 * i18next; the two answers are independent, so they are two functions rather
 * than one enum with the product of both.
 *
 * **Only i18next is supported today, and the type says so.** The other two are
 * named in the union because a project using them is recognised and told
 * plainly that it is not handled — which is a better answer than being told no
 * i18n library was found, and is the difference between "not yet" and "we
 * looked and there is nothing here".
 */
export type I18nLibraryId = 'i18next' | 'next-intl' | 'react-intl';

export interface I18nLibrary {
  id: I18nLibraryId;
  /** What the package.json entry was, for a report that has to be checkable. */
  packageName: string;
  /** False for the ones recognised but not yet analysed. */
  supported: boolean;
}

/**
 * Matched in this order, and the order carries a decision.
 *
 * A project can hold more than one of these — `react-i18next` alongside a
 * leftover `react-intl`, a migration half done. The first match wins rather
 * than the analysis refusing to choose, and i18next is first because it is the
 * one this slice actually analyses: given a genuinely mixed project, answering
 * about the half we can check beats answering about neither.
 */
const CANDIDATES: readonly {
  id: I18nLibraryId;
  packages: readonly string[];
  supported: boolean;
}[] = [
  {
    id: 'i18next',
    // `i18next` is the engine; `react-i18next` is the binding and is what a
    // React app depends on directly. Either is enough to say the answer.
    packages: ['i18next', 'react-i18next'],
    supported: true,
  },
  { id: 'next-intl', packages: ['next-intl'], supported: false },
  {
    id: 'react-intl',
    packages: ['react-intl', '@formatjs/intl'],
    supported: false,
  },
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(rootDir: string): PackageJson | null {
  const path = join(rootDir, 'package.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PackageJson;
  } catch {
    /*
     * Unparseable is the same answer as absent, on purpose. This function is
     * asked "which library", and a broken manifest is not evidence of one. The
     * caller reports "no i18n library detected", which is true of what could be
     * established, rather than failing an entire check on a syntax error the
     * author is probably already staring at.
     */
    return null;
  }
}

/**
 * Both dependency maps, because a monorepo or a template frequently lists the
 * i18n library as a devDependency and it is no less present for that.
 */
function hasDependency(pkg: PackageJson, name: string): boolean {
  return (
    pkg.dependencies?.[name] !== undefined ||
    pkg.devDependencies?.[name] !== undefined
  );
}

export function detectI18nLibrary(rootDir: string): I18nLibrary | null {
  const pkg = readPackageJson(rootDir);
  if (!pkg) return null;

  for (const candidate of CANDIDATES) {
    const found = candidate.packages.find((name) => hasDependency(pkg, name));
    if (found) {
      return {
        id: candidate.id,
        packageName: found,
        supported: candidate.supported,
      };
    }
  }
  return null;
}
