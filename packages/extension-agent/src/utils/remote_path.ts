/** @module utils/remote_path */

import { posix } from 'path'

export function computeRemoteDir(scope: string, dir: string) {
    const value = dir.replaceAll('\\', '/').trim()
    if (value === '~' || value.startsWith('~/')) {
        return value
    }

    if (value.startsWith('/')) {
        return posix.normalize(value)
    }

    if (
        [
            '.agents/',
            '.openclaw/',
            '.codex/',
            '.claude/',
            '.config/opencode/'
        ].some((item) => value.startsWith(item))
    ) {
        return `~/${value}`
    }

    const next = value.replace(/^\.\//, '').replace(/^\//, '')
    if (scope === '~') {
        return `~/${next}`
    }

    if (scope.startsWith('~/')) {
        return `${scope.replace(/\/+$/, '')}/${next}`
    }

    return posix.resolve(scope || '/', value)
}

export function isRemotePathInside(path: string, root: string) {
    const target = path.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
    const base = root.replaceAll('\\', '/').replace(/\/+$/, '') || '/'
    return target === base || target.startsWith(`${base}/`)
}
