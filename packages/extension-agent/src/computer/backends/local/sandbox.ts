/** @module computer/backends/local/sandbox */

import { spawnSync } from 'node:child_process'
import path from 'path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'

const PROTECTED_NAMES = ['.git', '.chatluna', '.agents', '.codex', '.claude']
const BWRAP_PROBE_CACHE = new Set<string>()

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

    if (
        mode === 'write' &&
        resolved
            .replaceAll('\\', '/')
            .split('/')
            .some((s) => PROTECTED_NAMES.includes(s))
    ) {
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
        WRITE_COMMAND_PATTERNS.some((p) => p.test(command))
    ) {
        throw new Error('Local backend is running in read-only mode.')
    }

    if (
        command
            .replaceAll('\\', '/')
            .split('/')
            .some((s) => PROTECTED_NAMES.includes(s))
    ) {
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
    if (process.platform === 'win32' || cfg.dangerouslySkipPermissions) {
        return command
    }

    const bwrap = which.sync('bwrap', { nothrow: true })
    if (!bwrap) {
        throw new Error(
            'Local backend sandbox requires bubblewrap (`bwrap`), but it is not installed.'
        )
    }

    if (!BWRAP_PROBE_CACHE.has(bwrap)) {
        const result = spawnSync(
            bwrap,
            [
                '--ro-bind',
                '/',
                '/',
                '--bind',
                tmp,
                '/tmp',
                '--dev',
                '/dev',
                '--proc',
                '/proc',
                'sh',
                '-lc',
                'true'
            ],
            { encoding: 'utf8' }
        )

        if (result.status === 0) {
            BWRAP_PROBE_CACHE.add(bwrap)
        } else {
            const err =
                result.stderr?.trim() ||
                result.error?.message ||
                'bubblewrap startup probe failed.'
            throw new Error(
                `Local backend sandbox requires bubblewrap, but the startup probe failed: ${err}`
            )
        }
    }

    return [
        quote(bwrap),
        cfg.sandboxMode === 'read-only' ? '--ro-bind / /' : '--bind / /',
        cfg.sandboxMode === 'read-only'
            ? `--ro-bind ${quote(tmp)} /tmp`
            : `--bind ${quote(tmp)} /tmp`,
        '--dev /dev',
        '--proc /proc',
        '--die-with-parent',
        ...(cfg.networkPolicy === 'block' ? ['--unshare-net'] : []),
        'sh -lc',
        quote(command)
    ].join(' ')
}

function isInsideRoot(target: string, root: string) {
    const t = path.resolve(target)
    const r = path.resolve(root)
    return t === r || t.startsWith(r + path.sep)
}

function quote(v: string) {
    return `'${v.replaceAll("'", `'\\''`)}'`
}
