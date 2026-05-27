/** @module mcp/tool_call */

import { RunnableConfig } from '@langchain/core/runnables'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Context, Logger } from 'koishi'
import { convertCallToolResult } from './content'
import { isToolException, ToolException } from './types'

/**
 * 调用 MCP 工具并转换响应。
 *
 * 流程：
 * 1. 根据 runnable config 生成 timeout/signal 请求选项
 * 2. 调用 MCP client.callTool
 * 3. 将返回的 content blocks 转成 ChatLuna 可消费结构
 * 4. 保留 ToolException，其他错误统一包装
 */
export async function callTool(
    serverName: string,
    toolName: string,
    client: Client,
    args: Record<string, unknown>,
    config: RunnableConfig | undefined,
    useStandardContentBlocks: boolean | undefined,
    ctx: Context,
    logger: Logger
) {
    try {
        logger.debug(
            `Calling MCP tool '${toolName}' on server '${serverName}' with args:`,
            JSON.stringify(args, null, 2)
        )

        const opts: RequestOptions = {
            ...(config?.timeout ? { timeout: config.timeout } : {}),
            ...(config?.signal ? { signal: config.signal } : {})
        }

        const result =
            Object.keys(opts).length > 0
                ? await client.callTool(
                      { name: toolName, arguments: args },
                      undefined,
                      opts
                  )
                : await client.callTool({ name: toolName, arguments: args })

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
