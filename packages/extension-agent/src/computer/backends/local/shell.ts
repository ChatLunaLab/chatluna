/** @module computer/backends/local/shell */

import fs from 'fs/promises'
import path from 'path'
import which from 'which'
import { LocalBackendConfig } from '../../../types'

export interface ResolvedShellCommand {
    file: string
    args: string[]
    env?: NodeJS.ProcessEnv
}

function gitBashEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        CHERE_INVOKING: '1',
        LANG: process.env['LANG'] || 'C.UTF-8',
        LC_ALL: process.env['LC_ALL'] || 'C.UTF-8'
    }
}

function buildUtf8Env(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
    }
}

export function findPowerShell(): string | undefined {
    return (
        which.sync('pwsh.exe', { nothrow: true }) ??
        which.sync('pwsh', { nothrow: true }) ??
        which.sync('powershell.exe', { nothrow: true })
    )
}

export function getPosixShell() {
    return (
        process.env['SHELL'] ||
        which.sync('zsh', { nothrow: true }) ||
        which.sync('bash', { nothrow: true }) ||
        which.sync('sh', { nothrow: true }) ||
        'sh'
    )
}

export function getPosixShellArgs(command?: string) {
    const shell = path.basename(getPosixShell()).replace(/\.exe$/i, '')

    if (command == null) {
        if (shell.includes('fish')) {
            return ['--interactive']
        }

        return ['-i']
    }

    if (shell.includes('fish')) {
        return ['--interactive', '--command', command]
    }

    if (shell.includes('bash') || shell.includes('zsh')) {
        return ['-ic', command]
    }

    return ['-c', command]
}

function resolvePowerShellCommand(command: string): ResolvedShellCommand {
    return {
        file: findPowerShell() ?? 'powershell.exe',
        args: [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            [
                '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
                '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
                '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
                "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
                "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
                'chcp.com 65001 > $null',
                command
            ].join('; ')
        ],
        env: buildUtf8Env()
    }
}

export async function resolveInteractiveShellCommand(
    cfg: LocalBackendConfig
): Promise<ResolvedShellCommand> {
    if (process.platform !== 'win32') {
        const shell = getPosixShell()
        return {
            file: shell,
            args: getPosixShellArgs()
        }
    }

    if (cfg.preferredShell === 'cmd') {
        return {
            file: 'cmd.exe',
            args: ['/q'],
            env: buildUtf8Env()
        }
    }

    if (cfg.preferredShell === 'powershell') {
        return {
            file: findPowerShell() ?? 'powershell.exe',
            args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
            env: buildUtf8Env()
        }
    }

    const gitBash = await findGitBash()
    if (gitBash) {
        return { file: gitBash, args: ['-i'], env: gitBashEnv() }
    }

    return {
        file: findPowerShell() ?? 'powershell.exe',
        args: ['-NoLogo', '-ExecutionPolicy', 'Bypass'],
        env: buildUtf8Env()
    }
}

export async function resolveShellCommand(
    command: string,
    cfg: LocalBackendConfig
): Promise<ResolvedShellCommand> {
    if (process.platform !== 'win32') {
        const shell = getPosixShell()
        return {
            file: shell,
            args: getPosixShellArgs(command)
        }
    }

    if (cfg.preferredShell === 'cmd') {
        return {
            file: 'cmd.exe',
            args: ['/d', '/s', '/c', `chcp.com 65001 > nul && ${command}`],
            env: buildUtf8Env()
        }
    }

    if (cfg.preferredShell === 'powershell') {
        return resolvePowerShellCommand(command)
    }

    if (cfg.preferredShell === 'git-bash') {
        const gitBash = await findGitBash()
        if (gitBash) {
            return { file: gitBash, args: ['-lc', command], env: gitBashEnv() }
        }
    }

    const gitBash = await findGitBash()
    if (gitBash) {
        return { file: gitBash, args: ['-lc', command], env: gitBashEnv() }
    }

    return resolvePowerShellCommand(command)
}

export async function findGitBash(): Promise<string | null> {
    if (process.platform !== 'win32') {
        return null
    }

    const roots = new Set<string>()
    const gitPaths = [
        which.sync('git.exe', { nothrow: true }),
        which.sync('git', { nothrow: true })
    ].filter((item): item is string => item != null)

    for (const p of gitPaths) {
        const dir = path.dirname(p)
        roots.add(path.resolve(dir, '..'))
        roots.add(path.resolve(dir, '..', '..'))
    }

    for (const key of [
        'ProgramW6432',
        'ProgramFiles',
        'ProgramFiles(x86)',
        'LocalAppData'
    ]) {
        const base = process.env[key]
        if (base) {
            roots.add(path.join(base, 'Git'))
        }
    }

    for (const root of roots) {
        for (const rel of ['bin\\bash.exe', 'usr\\bin\\bash.exe']) {
            const p = path.resolve(root, rel)
            try {
                await fs.access(p)
                return p
            } catch {}
        }
    }

    return null
}
