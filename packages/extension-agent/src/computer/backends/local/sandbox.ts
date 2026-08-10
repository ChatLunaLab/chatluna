/** @module computer/backends/local/sandbox */

import { spawnSync } from 'child_process'
import { lstatSync, realpathSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import { getPosixShell, getPosixShellArgs } from './shell'

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
    if (process.platform === 'win32' || cfg.dangerouslySkipPermissions) {
        return command
    }

    const bwrap = which.sync('bwrap', { nothrow: true })
    if (!bwrap && process.platform === 'darwin') {
        const sandboxExec = which.sync('sandbox-exec', { nothrow: true })
        if (!sandboxExec) {
            throw new Error(
                'Local backend sandbox requires macOS sandbox-exec, but it is not available.'
            )
        }

        const shell = getPosixShell()
        const shellSelector = '/private/var/select'
        const roots = await Promise.all(
            [cfg.scopePath || workdir, ...cfg.readOnlyRoots, tmp].map(
                async (item) => {
                    const value = path.resolve(item)
                    return await fs.realpath(value).catch(() => value)
                }
            )
        )
        const runtime = await Promise.all(
            [shell, process.execPath].map(async (item) => {
                const value = path.resolve(item)
                return await fs.realpath(value).catch(() => value)
            })
        )
        const runtimeRoots = Array.from(
            new Set(
                runtime.map((item) => {
                    const root = path.dirname(path.dirname(item))
                    return root === path.parse(root).root
                        ? path.dirname(item)
                        : root
                })
            )
        )
        const moduleRoots = new Set<string>()
        for (const start of [roots[0], process.cwd()]) {
            let current = path.resolve(start)
            while (true) {
                const dir = await fs
                    .realpath(path.join(current, 'node_modules'))
                    .catch(() => undefined)
                if (dir) moduleRoots.add(dir)
                if (current === path.dirname(current)) break
                current = path.dirname(current)
            }
        }
        const readRoots = [
            ...roots,
            ...runtimeRoots,
            ...Array.from(moduleRoots),
            shellSelector
        ]
        const readParams: [string, string][] = [
            ['SCOPE', roots[0]],
            ...roots
                .slice(1, 1 + cfg.readOnlyRoots.length)
                .map(
                    (item, idx) =>
                        [`READ_ONLY_${idx}`, item] as [string, string]
                ),
            ['TMP', roots.at(-1)!],
            ...runtimeRoots.map(
                (item, idx) => [`RUNTIME_${idx}`, item] as [string, string]
            ),
            ...Array.from(moduleRoots).map(
                (item, idx) => [`MODULES_${idx}`, item] as [string, string]
            ),
            ['SHELL_SELECTOR', shellSelector]
        ]
        const parents = new Set<string>()
        for (const item of readRoots) {
            let current = path.dirname(item)
            while (current !== path.dirname(current)) {
                parents.add(current)
                current = path.dirname(current)
            }
        }
        const denied = await Promise.all(
            cfg.denyRoots.map(async (item) => {
                const value = path.resolve(item)
                return await fs.realpath(value).catch(() => value)
            })
        )
        const params: [string, string][] = [
            ...readParams,
            ...Array.from(parents).map(
                (item, idx) => [`PARENT_${idx}`, item] as [string, string]
            ),
            ...denied.map(
                (item, idx) => [`DENY_${idx}`, item] as [string, string]
            )
        ]
        const profile = [
            '(version 1)',
            '(deny default)',
            '(import "system.sb")',
            '(allow process*)',
            '(allow file-read* file-test-existence ' +
                '(subpath "/bin") (subpath "/sbin") ' +
                '(subpath "/usr/bin") (subpath "/usr/sbin") ' +
                '(subpath "/usr/libexec") (subpath "/private/etc"))',
            `(allow file-read* file-test-existence ${readParams.map(([key]) => `(subpath (param "${key}"))`).join(' ')})`,
            `(allow file-map-executable ${readParams.map(([key]) => `(subpath (param "${key}"))`).join(' ')})`,
            `(allow file-read-metadata file-test-existence ${Array.from(parents)
                .map((_, idx) => `(literal (param "PARENT_${idx}"))`)
                .join(' ')})`,
            ...(cfg.sandboxMode === 'workspace-write'
                ? [
                      '(allow file-write* (subpath (param "SCOPE")) (subpath (param "TMP")))'
                  ]
                : []),
            ...roots
                .slice(1, 1 + cfg.readOnlyRoots.length)
                .map(
                    (_, idx) =>
                        `(deny file-write* (subpath (param "READ_ONLY_${idx}")))`
                ),
            ...denied.map(
                (_, idx) =>
                    `(deny file-read* file-write* (subpath (param "DENY_${idx}")))`
            ),
            cfg.networkPolicy === 'block'
                ? '(deny network*)'
                : '(allow network*)'
        ].join(' ')
        return [
            quote(sandboxExec),
            ...params.flatMap(([key, value]) => [
                '-D',
                quote(`${key}=${value}`)
            ]),
            '-p',
            quote(profile),
            quote(shell),
            ...getPosixShellArgs(shell, interactive ? undefined : command).map(
                (arg) => quote(arg)
            )
        ].join(' ')
    }

    if (!bwrap) {
        throw new Error(
            'Local backend sandbox requires bubblewrap (`bwrap`), but it is not installed.'
        )
    }

    if (!BWRAP_PROBE_CACHE.has(bwrap)) {
        const shell = getPosixShell()
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
                shell,
                ...getPosixShellArgs(shell, 'true')
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

    const shell = getPosixShell()
    const args = [
        quote(bwrap),
        '--ro-bind / /',
        cfg.sandboxMode === 'workspace-write'
            ? `--bind ${quote(cfg.scopePath || workdir)} ${quote(cfg.scopePath || workdir)}`
            : undefined,
        cfg.sandboxMode === 'workspace-write' &&
        path.resolve(workdir) !== path.resolve(cfg.scopePath || workdir)
            ? `--bind ${quote(workdir)} ${quote(workdir)}`
            : undefined,
        cfg.sandboxMode === 'read-only'
            ? `--ro-bind ${quote(tmp)} /tmp`
            : `--bind ${quote(tmp)} /tmp`,
        '--setenv TMP /tmp',
        '--setenv TEMP /tmp',
        '--setenv TMPDIR /tmp',
        '--setenv TMPPREFIX /tmp/zsh',
        ...cfg.readOnlyRoots.map(
            (root) => `--ro-bind ${quote(root)} ${quote(root)}`
        ),
        ...cfg.denyRoots.map((root) => `--tmpfs ${quote(root)}`),
        '--dev /dev',
        '--proc /proc',
        '--die-with-parent',
        ...(cfg.networkPolicy === 'block' ? ['--unshare-net'] : []),
        quote(shell),
        ...getPosixShellArgs(shell, interactive ? undefined : command).map(
            (arg) => quote(arg)
        )
    ].filter((arg): arg is string => arg != null)

    return args.join(' ')
}

async function isInsideRootAsync(target: string, root: string) {
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

export function isInsideRoot(target: string, root: string) {
    let t = path.resolve(target)
    const r = path.resolve(root)
    try {
        t = realpathSync.native(t)
    } catch {
        let current = t
        while (current !== path.dirname(current)) {
            try {
                if (lstatSync(current).isSymbolicLink()) return false
            } catch {}
            current = path.dirname(current)
            try {
                t = path.join(
                    realpathSync.native(current),
                    path.relative(current, t)
                )
                break
            } catch {}
        }
    }

    let r2 = r
    try {
        r2 = realpathSync.native(r)
    } catch {
        try {
            if (lstatSync(r).isSymbolicLink()) return false
        } catch {}
    }
    return t === r2 || t.startsWith(r2 + path.sep)
}

function quote(v: string) {
    return `'${v.replaceAll("'", `'\\''`)}'`
}
