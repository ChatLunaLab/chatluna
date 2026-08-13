/** @module computer/backends/local/sandbox_linux */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import { getPosixShell, getPosixShellArgs } from './shell'

const BWRAP_PROBE_CACHE = new Set<string>()

function quote(v: string) {
    return `'${v.replaceAll("'", `'\\''`)}'`
}

export function buildLinuxSandbox(
    command: string,
    workdir: string,
    cfg: LocalBackendConfig,
    tmp: string,
    interactive = false
) {
    const bwrap = which.sync('bwrap', { nothrow: true })
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
