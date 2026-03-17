import { randomBytes } from 'crypto'
import path from 'path'
/** @module computer/backends/local/security */

import { Session } from 'koishi'
import { LocalBackendConfig } from '../../../types'

const HIGH_RISK_PATTERNS: RegExp[] = [
    /\brm\b/,
    /\brmdir\b/,
    /\bdel\b/i,
    /\brd\b/,
    /\bformat\b/i,
    /\bshred\b/,
    /\bsudo\b/,
    /\bsu\b(?:\s|$)/,
    /\brunas\b/i,
    /\bchmod\b/,
    /\bchown\b/,
    /\bcurl\b.*\|\s*(?:ba)?sh/,
    /\bwget\b.*\|\s*(?:ba)?sh/,
    /\bkill\b/,
    /\btaskkill\b/i,
    /\bnpm\s+(?:install|uninstall|publish)\b/,
    /\bpnpm\s+(?:install|uninstall|publish)\b/,
    /\byarn\s+(?:add|remove)\b/,
    /\bpip\s+(?:install|uninstall)\b/,
    /\breg\s+(?:add|delete|import|export)\b/i,
    /\bsysctl\b/,
    /\bdd\b/,
    /\bmkfs\b/,
    /\bfdisk\b/,
    /\bdiskpart\b/i
]

export function isHighRisk(command: string) {
    return HIGH_RISK_PATTERNS.some((pattern) => pattern.test(command))
}

export function ensureCommandAllowed(command: string, cfg: LocalBackendConfig) {
    if (cfg.dangerouslySkipPermissions) {
        return
    }

    const baseCmd = command.trim().split(/\s+/)[0]?.toLowerCase()
    if (!baseCmd) {
        throw new Error('Command is empty.')
    }

    if (cfg.blockedCommands.some((item) => baseCmd === item.toLowerCase())) {
        throw new Error(`Command "${baseCmd}" is blocked by configuration.`)
    }

    if (
        cfg.allowedCommands.length > 0 &&
        !cfg.allowedCommands.some((item) => baseCmd === item.toLowerCase())
    ) {
        throw new Error(
            `Command "${baseCmd}" is not in the allowed commands list.`
        )
    }
}

export function ensureWorkdirInScope(workdir: string, cfg: LocalBackendConfig) {
    if (cfg.dangerouslySkipPermissions || !cfg.scopePath) {
        return
    }

    const resolvedWorkdir = path.resolve(workdir)
    const resolvedScope = path.resolve(cfg.scopePath)
    if (
        resolvedWorkdir !== resolvedScope &&
        !resolvedWorkdir.startsWith(resolvedScope + path.sep)
    ) {
        throw new Error(
            `Working directory "${workdir}" is outside the configured scope path "${cfg.scopePath}".`
        )
    }
}

export function ensureCommandPathsInScope(
    command: string,
    cfg: LocalBackendConfig,
    isInScope: (filePath: string) => boolean
) {
    if (cfg.dangerouslySkipPermissions || !cfg.scopePath) {
        return
    }

    const absolutePathPattern = /(?:^|\s)(\/[^\s]+|[A-Za-z]:[^\s]+)/g
    for (const match of command.matchAll(absolutePathPattern)) {
        const filePath = match[1]
        if (!isInScope(path.resolve(filePath))) {
            throw new Error(
                `Command references path "${filePath}" which is outside the scope path "${cfg.scopePath}".`
            )
        }
    }
}

export async function confirmHighRiskCommand(
    command: string,
    cfg: LocalBackendConfig,
    session?: Session
) {
    if (
        cfg.dangerouslySkipPermissions ||
        cfg.approvalMode === 'never' ||
        !isHighRisk(command)
    ) {
        return
    }

    if (!session) {
        throw new Error(
            'High-risk command requires an interactive session for confirmation.'
        )
    }

    const token = randomBytes(6).toString('hex').slice(0, 8)
    await session.send(
        `模型请求执行高危命令：\n\`${command}\`\n如需同意，请输入以下字符：${token}`
    )
    const reply = await session.prompt()
    if (reply?.trim() !== token) {
        throw new Error(
            'Command execution cancelled: user did not confirm the high-risk operation.'
        )
    }
}
