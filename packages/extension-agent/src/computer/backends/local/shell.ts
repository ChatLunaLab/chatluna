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

export async function resolveInteractiveShellCommand(
    cfg: LocalBackendConfig
): Promise<ResolvedShellCommand> {
    if (process.platform !== 'win32') {
        return {
            file: process.env['SHELL'] || 'bash',
            args: ['-i']
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

    const gitBashPath = await findGitBash()
    if (gitBashPath) {
        return {
            file: gitBashPath,
            args: ['-i'],
            env: {
                ...process.env,
                CHERE_INVOKING: '1',
                LANG: process.env['LANG'] || 'C.UTF-8',
                LC_ALL: process.env['LC_ALL'] || 'C.UTF-8'
            }
        }
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
        return {
            file: process.env['SHELL'] || 'bash',
            args: ['-lc', command]
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
        const gitBashPath = await findGitBash()
        if (gitBashPath) {
            return {
                file: gitBashPath,
                args: ['-lc', command],
                env: {
                    ...process.env,
                    CHERE_INVOKING: '1',
                    LANG: process.env['LANG'] || 'C.UTF-8',
                    LC_ALL: process.env['LC_ALL'] || 'C.UTF-8'
                }
            }
        }
    }

    const gitBashPath = await findGitBash()
    if (gitBashPath) {
        return {
            file: gitBashPath,
            args: ['-lc', command],
            env: {
                ...process.env,
                CHERE_INVOKING: '1',
                LANG: process.env['LANG'] || 'C.UTF-8',
                LC_ALL: process.env['LC_ALL'] || 'C.UTF-8'
            }
        }
    }

    return resolvePowerShellCommand(command)
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
            buildWindowsPowerShellCommand(command)
        ],
        env: buildUtf8Env()
    }
}

function buildWindowsPowerShellCommand(command: string) {
    return [
        '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
        "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
        "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
        'chcp.com 65001 > $null',
        command
    ].join('; ')
}

export function findPowerShell(): string | undefined {
    return (
        which.sync('pwsh.exe', { nothrow: true }) ??
        which.sync('pwsh', { nothrow: true }) ??
        which.sync('powershell.exe', { nothrow: true })
    )
}

function buildUtf8Env(
    base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    return {
        ...base,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
    }
}

export async function findGitBash(): Promise<string | null> {
    if (process.platform !== 'win32') {
        return null
    }

    const exists = async (targetPath: string) => {
        try {
            await fs.access(targetPath)
            return true
        } catch {
            return false
        }
    }

    const roots = new Set<string>()
    const gitPaths = [
        which.sync('git.exe', { nothrow: true }),
        which.sync('git', { nothrow: true })
    ].filter((item): item is string => item != null)

    for (const gitPath of gitPaths) {
        const dir = path.dirname(gitPath)
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
        for (const relativePath of ['bin\\bash.exe', 'usr\\bin\\bash.exe']) {
            const candidate = path.resolve(root, relativePath)
            if (await exists(candidate)) {
                return candidate
            }
        }
    }

    return null
}
