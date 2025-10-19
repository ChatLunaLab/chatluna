import { Context } from 'koishi'
import { ChatChain } from '../chains/chain'
import { Config } from '../config'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.inject(['chatluna_mcp'], (ctx) => {
        ctx.command('chatluna.mcp', { authority: 1 })

        // List command
        ctx.command('chatluna.mcp.list').action(async ({ session }) => {
            await chain.receiveCommand(session, 'list_mcp_tools', {})
        })

        // Add command
        ctx.command('chatluna.mcp.add <mcpConfig:text>', {
            authority: 3
        }).action(async ({ session }, mcpConfig) => {
            await chain.receiveCommand(session, 'add_mcp_server', {
                mcpConfig
            })
        })

        // Remove command
        ctx.command('chatluna.mcp.remove <serverName:string>', {
            authority: 3
        }).action(async ({ session }, serverName) => {
            await chain.receiveCommand(session, 'remove_mcp_server', {
                serverName
            })
        })

        // Enable/Disable tool
        ctx.command('chatluna.mcp.enable <toolName:string>', {
            authority: 3
        }).action(async ({ session }, toolName) => {
            await chain.receiveCommand(session, 'enable_mcp_tool', {
                toolName
            })
        })
    })
}
