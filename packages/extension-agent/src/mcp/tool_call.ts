import { RunnableConfig } from '@langchain/core/runnables'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Context } from 'koishi'
import { convertCallToolResult } from './content'
import { isToolException, ToolException } from './types'

export async function callTool(
    serverName: string,
    toolName: string,
    client: Client,
    args: Record<string, unknown>,
    config: RunnableConfig | undefined,
    useStandardContentBlocks: boolean | undefined,
    ctx: Context,
    logger: { debug: (msg: string, ...args: any[]) => void }
) {
    try {
        logger.debug(
            `Calling MCP tool '${toolName}' on server '${serverName}' with args:`,
            JSON.stringify(args, null, 2)
        )

        const requestOptions: RequestOptions = {
            ...(config?.timeout ? { timeout: config.timeout } : {}),
            ...(config?.signal ? { signal: config.signal } : {})
        }

        const callToolArgs: Parameters<typeof client.callTool> = [
            {
                name: toolName,
                arguments: args
            }
        ]

        if (Object.keys(requestOptions).length > 0) {
            callToolArgs.push(undefined)
            callToolArgs.push(requestOptions)
        }

        const result = await client.callTool(...callToolArgs)

        return convertCallToolResult(
            serverName,
            toolName,
            result as CallToolResult,
            client,
            useStandardContentBlocks,
            ctx
        )
    } catch (error) {
        if (isToolException(error)) {
            throw error
        }
        throw new ToolException(
            `Error calling tool ${toolName}: ${String(error)}`
        )
    }
}
