import { lstatSync, readFileSync, type Stats } from 'node:fs';
import { join } from 'node:path';

/** Files larger than this are not read, from a checkout or from GitHub. */
export const MAX_FILE_SIZE = 1024 * 1024;

export type FileProblem =
  | { problem: 'missing' }
  /** `link`: the part of the path that is a symbolic link, relative to the base. */
  | { problem: 'symlink'; link: string }
  | { problem: 'not-a-file' }
  | { problem: 'too-large'; size: number };

/**
 * Reads a file below `base` (the `.architecture/` folder) without following symbolic links. A
 * link can point anywhere on the machine that runs Furio, such as a CI runner and its secrets,
 * and what Furio reads ends up on the map: only regular files inside the folder are read.
 */
export function readInside(base: string, relativePath: string): { text: string } | FileProblem {
  const parts = relativePath.split(/[\\/]+/).filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) return { problem: 'missing' };
  let current = base;
  let stats: Stats | undefined;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      stats = lstatSync(current, { throwIfNoEntry: false });
    } catch {
      // A part of the path is a file, or cannot be looked at.
      stats = undefined;
    }
    if (!stats) return { problem: 'missing' };
    if (stats.isSymbolicLink())
      return { problem: 'symlink', link: parts.slice(0, index + 1).join('/') };
  }
  if (!stats?.isFile()) return { problem: 'not-a-file' };
  if (stats.size > MAX_FILE_SIZE) return { problem: 'too-large', size: stats.size };
  try {
    return { text: readFileSync(current, 'utf8') };
  } catch {
    // Not readable (permissions, or gone in the meantime): as good as not there.
    return { problem: 'missing' };
  }
}

/** Whether the path itself is a symbolic link (what it points to is not looked at). */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
  } catch {
    return false;
  }
}
