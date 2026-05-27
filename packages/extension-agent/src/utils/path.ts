import { homedir } from 'os'
import { resolve } from 'path'

export function isPathInside(dir: string, root: string): boolean {
    const a = resolve(dir)
    const b = resolve(root)
    return a === b || a.startsWith(`${b}\\`) || a.startsWith(`${b}/`)
}

export function toPathKey(dir: string): string {
    return resolve(dir).replaceAll('\\', '/').toLowerCase()
}

export function expandDir(baseDir: string, dir: string): string {
    if (
        [
            '.agents/',
            '.agents\\',
            '.codex/',
            '.codex\\',
            '.claude/',
            '.claude\\',
            '.config/opencode/',
            '.config\\opencode\\'
        ].some((p) => dir.startsWith(p))
    ) {
        return resolve(homedir(), dir)
    }
    if (dir === '~') return homedir()
    if (dir.startsWith('~/') || dir.startsWith('~\\')) {
        return resolve(homedir(), dir.slice(2))
    }
    return resolve(baseDir, dir)
}
