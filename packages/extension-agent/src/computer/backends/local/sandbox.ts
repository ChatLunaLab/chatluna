/** @module computer/backends/local/sandbox */

import path from 'path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'

const PROTECTED_NAMES = ['.git', '.chatluna', '.agents', '.codex', '.claude']

const WRITE_COMMAND_PATTERNS = [
    />/,
    />>/,
    /\bmkdir\b/,
    /\brmdir\b/,
    /\brm\b/,
    /\bdel\b/i,
    /\bmv\b/,
    /\bmove\b/i,
    /\bcp\b/,
    /\bcopy\b/i,
    /\btee\b/,
    /\btouch\b/,
    /\bsed\b.*-i/,
    /\bperl\b.*-pi/,
    /\bgit\s+checkout\b/,
    /\bgit\s+clean\b/
]

export function ensureLocalPathAccess(
    filePath: string,
    cfg: LocalBackendConfig,
    mode: 'read' | 'write'
) {
    if (cfg.dangerouslySkipPermissions) {
        return
    }

    const resolved = path.resolve(filePath)

    if (cfg.denyRoots.some((root) => isInsideRoot(resolved, root))) {
        throw new Error(`Path "${filePath}" is denied by configuration.`)
    }

    if (mode === 'write' && containsProtectedName(resolved)) {
        throw new Error(
            `Path "${filePath}" is protected and cannot be modified.`
        )
    }

    if (mode === 'write' && cfg.sandboxMode === 'read-only') {
        throw new Error('Local backend is running in read-only mode.')
    }

    if (
        mode === 'write' &&
        cfg.readOnlyRoots.some((root) => isInsideRoot(resolved, root))
    ) {
        throw new Error(`Path "${filePath}" is read-only by configuration.`)
    }

    if (
        mode === 'write' &&
        cfg.scopePath &&
        !isInsideRoot(resolved, cfg.scopePath) &&
        !cfg.writableRoots.some((root) => isInsideRoot(resolved, root))
    ) {
        throw new Error(`Path "${filePath}" is outside the writable workspace.`)
    }
}

export function ensureLocalCommandAccess(
    command: string,
    workdir: string,
    cfg: LocalBackendConfig
) {
    if (cfg.dangerouslySkipPermissions) {
        return
    }

    if (
        cfg.sandboxMode === 'read-only' &&
        WRITE_COMMAND_PATTERNS.some((item) => item.test(command))
    ) {
        throw new Error('Local backend is running in read-only mode.')
    }

    if (containsProtectedName(command)) {
        throw new Error('Command references a protected path.')
    }

    if (cfg.denyRoots.some((root) => isInsideRoot(workdir, root))) {
        throw new Error(
            `Working directory "${workdir}" is denied by configuration.`
        )
    }
}

export function wrapCommandWithSandbox(
    command: string,
    workdir: string,
    cfg: LocalBackendConfig,
    tmp: string
) {
    if (process.platform === 'win32') {
        return command
    }

    const bwrap = which.sync('bwrap', { nothrow: true })
    if (!bwrap) {
        return command
    }

    const scope = cfg.scopePath || workdir || process.cwd()
    const binds =
        cfg.sandboxMode === 'read-only'
            ? [`--ro-bind ${quote(scope)} ${quote(scope)}`]
            : [`--bind ${quote(scope)} ${quote(scope)}`]
    const temp =
        cfg.sandboxMode === 'read-only'
            ? [`--ro-bind ${quote(tmp)} /tmp`]
            : [`--bind ${quote(tmp)} /tmp`]
    const net = cfg.networkPolicy === 'block' ? ['--unshare-net'] : []

    return [
        quote(bwrap),
        '--ro-bind / /',
        ...binds,
        ...temp,
        '--dev /dev',
        '--proc /proc',
        '--die-with-parent',
        ...net,
        'sh -lc',
        quote(command)
    ].join(' ')
}

function isInsideRoot(target: string, root: string) {
    const resolvedTarget = path.resolve(target)
    const resolvedRoot = path.resolve(root)
    return (
        resolvedTarget === resolvedRoot ||
        resolvedTarget.startsWith(resolvedRoot + path.sep)
    )
}

function containsProtectedName(value: string) {
    return value
        .replaceAll('\\', '/')
        .split('/')
        .some((item) => PROTECTED_NAMES.includes(item))
}

function quote(value: string) {
    return `'${value.replaceAll("'", `'\\''`)}'`
}
