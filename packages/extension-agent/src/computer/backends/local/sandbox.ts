/** @module computer/backends/local/sandbox */

import fs from 'node:fs/promises'
import path from 'node:path'
import { LocalBackendConfig } from '../../../types'
import { buildDarwinSandbox } from './sandbox_darwin'
import { buildLinuxSandbox } from './sandbox_linux'

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

export async function ensureLocalPathAccess(
    filePath: string,
    cfg: LocalBackendConfig,
    mode: 'read' | 'write',
    tmp?: string
) {
    if (cfg.dangerouslySkipPermissions) {
        return
    }

    const resolved = path.resolve(filePath)

    for (const root of cfg.denyRoots) {
        if (await isInsideRootAsync(resolved, root)) {
            throw new Error(`Path "${filePath}" is denied by configuration.`)
        }
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

    if (mode === 'write') {
        for (const root of cfg.readOnlyRoots) {
            if (await isInsideRootAsync(resolved, root)) {
                throw new Error(
                    `Path "${filePath}" is read-only by configuration.`
                )
            }
        }
    }

    const roots = [
        cfg.scopePath || process.cwd(),
        ...(mode === 'read' ? cfg.readOnlyRoots : []),
        ...(tmp ? [tmp] : [])
    ]
    const inside = (
        await Promise.all(
            roots.map((root) => isInsideRootAsync(resolved, root))
        )
    ).some(Boolean)
    if (!inside) {
        throw new Error(`Path "${filePath}" is outside the local scope.`)
    }
}

export async function ensureLocalCommandAccess(
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

    for (const root of cfg.denyRoots) {
        if (await isInsideRootAsync(workdir, root)) {
            throw new Error(
                `Working directory "${workdir}" is denied by configuration.`
            )
        }
    }

    if (!(await isInsideRootAsync(workdir, cfg.scopePath || process.cwd()))) {
        throw new Error(
            `Working directory "${workdir}" is outside the local scope.`
        )
    }
}

export async function wrapCommandWithSandbox(
    command: string,
    workdir: string,
    cfg: LocalBackendConfig,
    tmp: string,
    interactive = false
) {
    if (!tmp) {
        throw new Error('Local computer session is disconnected')
    }

    if (process.platform === 'win32' || cfg.dangerouslySkipPermissions) {
        return command
    }

    if (process.platform === 'darwin') {
        return await buildDarwinSandbox(command, workdir, cfg, tmp, interactive)
    }

    return buildLinuxSandbox(command, workdir, cfg, tmp, interactive)
}

export async function isInsideRootAsync(target: string, root: string) {
    let t = path.resolve(target)
    const r = path.resolve(root)
    try {
        t = await fs.realpath(t)
    } catch {
        let current = t
        while (current !== path.dirname(current)) {
            try {
                if ((await fs.lstat(current)).isSymbolicLink()) return false
            } catch {}
            current = path.dirname(current)
            try {
                t = path.join(
                    await fs.realpath(current),
                    path.relative(current, t)
                )
                break
            } catch {}
        }
    }

    let r2 = r
    try {
        r2 = await fs.realpath(r)
    } catch {
        try {
            if ((await fs.lstat(r)).isSymbolicLink()) return false
        } catch {}
    }
    return t === r2 || t.startsWith(r2 + path.sep)
}
