import { randomBytes } from 'crypto'
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

export function ensureCommandAllowed(cmd: string, cfg: LocalBackendConfig) {
    if (cfg.dangerouslySkipPermissions) return

    const base = cmd.trim().split(/\s+/)[0]?.toLowerCase()
    if (!base) throw new Error('Command is empty.')

    if (cfg.blockedCommands.some((item) => base === item.toLowerCase())) {
        throw new Error(`Command "${base}" is blocked by configuration.`)
    }

    if (
        cfg.allowedCommands.length > 0 &&
        !cfg.allowedCommands.some((item) => base === item.toLowerCase())
    ) {
        throw new Error(
            `Command "${base}" is not in the allowed commands list.`
        )
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
        !HIGH_RISK_PATTERNS.some((p) => p.test(command))
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
    if ((await session.prompt())?.trim() !== token) {
        throw new Error(
            'Command execution cancelled: user did not confirm the high-risk operation.'
        )
    }
}
