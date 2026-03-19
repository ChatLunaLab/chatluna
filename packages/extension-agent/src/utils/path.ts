/**
 * @module utils/path
 * @description 路径标准化与目录归属判断工具。
 */

import { homedir } from 'os'
import { resolve } from 'path'

/** 判断 dir 是否在 root 内。 */
export function isPathInside(dir: string, root: string): boolean {
    const target = resolve(dir)
    const base = resolve(root)

    return (
        target === base ||
        target.startsWith(`${base}\\`) ||
        target.startsWith(`${base}/`)
    )
}

/** 路径标准化为小写正斜杠 key，用于去重。 */
export function toPathKey(dir: string): string {
    return resolve(dir).replaceAll('\\', '/').toLowerCase()
}

/** 解析 ~ 前缀和用户目录约定路径。 */
export function resolveTildeDir(baseDir: string, dir: string): string {
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
        ].some((item) => dir.startsWith(item))
    ) {
        return resolve(homedir(), dir)
    }

    if (dir === '~') {
        return homedir()
    }

    if (dir.startsWith('~/') || dir.startsWith('~\\')) {
        return resolve(homedir(), dir.slice(2))
    }

    return resolve(baseDir, dir)
}
