/** @module computer/backends/local/sandbox_darwin */

import fs from 'node:fs/promises'
import path from 'node:path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import { getPosixShell, getPosixShellArgs } from './shell'

function quote(v: string) {
    return `'${v.replaceAll("'", `'\\''`)}'`
}

async function resolveReal(item: string) {
    const value = path.resolve(item)
    return await fs.realpath(value).catch(() => value)
}

export async function buildDarwinSandbox(
    command: string,
    workdir: string,
    cfg: LocalBackendConfig,
    tmp: string,
    interactive = false
) {
    const sandboxExec = which.sync('sandbox-exec', { nothrow: true })
    if (!sandboxExec) {
        throw new Error(
            'Local backend sandbox requires macOS sandbox-exec, but it is not available.'
        )
    }

    const shell = getPosixShell()
    const shellSelector = '/private/var/select'
    const scope = await resolveReal(cfg.scopePath || workdir)
    const readOnlyRoots = await Promise.all(
        cfg.readOnlyRoots.map((item) => resolveReal(item))
    )
    const tmpRoot = await resolveReal(tmp)
    const runtime = await Promise.all(
        [shell, process.execPath].map((item) => resolveReal(item))
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
    for (const start of [scope, process.cwd()]) {
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
        scope,
        ...readOnlyRoots,
        tmpRoot,
        ...runtimeRoots,
        ...Array.from(moduleRoots),
        shellSelector
    ]
    const readParams: [string, string][] = [
        ['SCOPE', scope],
        ...readOnlyRoots.map(
            (item, idx) => [`READ_ONLY_${idx}`, item] as [string, string]
        ),
        ['TMP', tmpRoot],
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
        cfg.denyRoots.map((item) => resolveReal(item))
    )
    const params: [string, string][] = [
        ...readParams,
        ...Array.from(parents).map(
            (item, idx) => [`PARENT_${idx}`, item] as [string, string]
        ),
        ...denied.map((item, idx) => [`DENY_${idx}`, item] as [string, string])
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
        ...readOnlyRoots.map(
            (_, idx) =>
                `(deny file-write* (subpath (param "READ_ONLY_${idx}")))`
        ),
        ...denied.map(
            (_, idx) =>
                `(deny file-read* file-write* (subpath (param "DENY_${idx}")))`
        ),
        cfg.networkPolicy === 'block' ? '(deny network*)' : '(allow network*)'
    ].join(' ')
    return [
        quote(sandboxExec),
        ...params.flatMap(([key, value]) => ['-D', quote(`${key}=${value}`)]),
        '-p',
        quote(profile),
        quote(shell),
        ...getPosixShellArgs(shell, interactive ? undefined : command).map(
            (arg) => quote(arg)
        )
    ].join(' ')
}
