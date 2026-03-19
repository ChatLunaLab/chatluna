/**
 * @module mcp/content
 * @description MCP content block 转换。
 * 将 MCP 的 text/image/audio/resource 响应转换为 ChatLuna 可消费的
 * 标准内容块，必要时把二进制资源落到临时存储后再返回给模型。
 */

import {
    Base64ContentBlock,
    DataContentBlock,
    MessageContentComplex,
    MessageContentImageUrl,
    MessageContentText,
    PlainTextContentBlock,
    StandardAudioBlock,
    StandardFileBlock,
    StandardImageBlock
} from '@langchain/core/messages'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
    CallToolResult,
    EmbeddedResource,
    ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js'
import { Context } from 'koishi'
import { putResourceToChatLunaStorage } from './storage'
import { ToolException } from './types'

function isResourceReference(
    resource:
        | EmbeddedResource['resource']
        | ReadResourceResult['contents'][number]
) {
    return (
        typeof resource === 'object' &&
        resource !== null &&
        resource.uri != null &&
        resource['blob'] == null &&
        resource['text'] == null
    )
}

async function collectResourceBlocks(
    resource:
        | EmbeddedResource['resource']
        | ReadResourceResult['contents'][number],
    client: Client
): Promise<
    (
        | (StandardFileBlock & Base64ContentBlock)
        | (StandardFileBlock & PlainTextContentBlock)
    )[]
> {
    if (isResourceReference(resource)) {
        const response: ReadResourceResult = await client.readResource({
            uri: resource.uri
        })

        return (
            await Promise.all(
                response.contents.map((content) =>
                    collectResourceBlocks(content, client)
                )
            )
        ).flat()
    }

    const blocks: (
        | (StandardFileBlock & Base64ContentBlock)
        | (StandardFileBlock & PlainTextContentBlock)
    )[] = []

    if (resource['blob'] != null) {
        blocks.push({
            type: 'file',
            source_type: 'base64',
            data: resource['blob'],
            mime_type: resource.mimeType,
            ...(resource.uri != null ? { metadata: { uri: resource.uri } } : {})
        } as StandardFileBlock & Base64ContentBlock)
    }

    if (resource['text'] != null) {
        blocks.push({
            type: 'file',
            source_type: 'text',
            mime_type: resource.mimeType,
            text: resource['text'],
            ...(resource.uri != null ? { metadata: { uri: resource.uri } } : {})
        } as StandardFileBlock & PlainTextContentBlock)
    }

    return blocks
}

function convertTextBlock(
    content: Extract<CallToolResult['content'][0], { type: 'text' }>,
    useStandardContentBlocks: boolean | undefined
): MessageContentText[] {
    return [
        {
            type: 'text',
            ...(useStandardContentBlocks ? { source_type: 'text' } : {}),
            text: content.text
        } as MessageContentText
    ]
}

async function convertImageBlock(
    content: Extract<CallToolResult['content'][0], { type: 'image' }>,
    useStandardContentBlocks: boolean | undefined,
    ctx: Context
): Promise<(StandardImageBlock | MessageContentImageUrl)[]> {
    if (useStandardContentBlocks) {
        return [
            {
                type: 'image',
                source_type: 'base64',
                data: content.data,
                mime_type: content.mimeType
            } as StandardImageBlock
        ]
    }

    const file = await putResourceToChatLunaStorage(
        ctx,
        content.data as string,
        content.mimeType as string
    )

    if (file) {
        return [
            {
                type: 'image_url',
                image_url: file.url
            } as MessageContentImageUrl
        ]
    }

    return [
        {
            type: 'image_url',
            image_url: {
                url: `data:${content.mimeType};base64,${content.data}`
            }
        } as MessageContentImageUrl
    ]
}

function convertAudioBlock(
    content: Extract<CallToolResult['content'][0], { type: 'audio' }>
): StandardAudioBlock[] {
    return [
        {
            type: 'audio',
            source_type: 'base64',
            data: content.data,
            mime_type: content.mimeType
        } as StandardAudioBlock
    ]
}

async function convertResourceBlock(
    content: Extract<CallToolResult['content'][0], { type: 'resource' }>,
    client: Client,
    ctx: Context
): Promise<(MessageContentComplex | DataContentBlock)[]> {
    const blocks = await collectResourceBlocks(content['resource'], client)
    const files = await Promise.all(
        blocks.map(async (value) => {
            const buffer =
                value.source_type === 'text'
                    ? Buffer.from(value.text, 'utf-8')
                    : value.source_type === 'base64'
                      ? Buffer.from(value.data, 'base64')
                      : undefined

            if (buffer == null) {
                return undefined
            }

            return await putResourceToChatLunaStorage(
                ctx,
                buffer,
                value.mime_type
            )
        })
    ).then((list) => list.filter(Boolean))

    if (files.length > 0) {
        return files.map((file) => ({
            type: 'text',
            text: `Resource url: ${file.url}. Please show to user`
        }))
    }

    return blocks
}

async function toolOutputToContentBlocks(
    content: CallToolResult['content'][0],
    useStandardContentBlocks: boolean | undefined,
    client: Client,
    toolName: string,
    serverName: string,
    ctx: Context
): Promise<(MessageContentComplex | DataContentBlock)[]> {
    switch (content.type) {
        case 'text':
            return convertTextBlock(content, useStandardContentBlocks)
        case 'image':
            return await convertImageBlock(
                content,
                useStandardContentBlocks,
                ctx
            )
        case 'audio':
            return convertAudioBlock(content)
        case 'resource':
            return await convertResourceBlock(content, client, ctx)
        default:
            throw new ToolException(
                `MCP tool '${toolName}' on server '${serverName}' returned a content block with unexpected type "${
                    content['type']
                }." Expected one of "text", "image", or "audio".`
            )
    }
}

export async function convertCallToolResult(
    serverName: string,
    toolName: string,
    result: CallToolResult,
    client: Client,
    useStandardContentBlocks: boolean | undefined,
    ctx: Context
): Promise<
    [
        (MessageContentComplex | DataContentBlock)[],
        (EmbeddedResource | DataContentBlock)[]
    ]
> {
    if (!result) {
        throw new ToolException(
            `MCP tool '${toolName}' on server '${serverName}' returned an invalid result - tool call response was undefined`
        )
    }

    if (!Array.isArray(result.content)) {
        throw new ToolException(
            `MCP tool '${toolName}' on server '${serverName}' returned an invalid result - expected an array of content, but was ${typeof result.content}`
        )
    }

    if (result.isError) {
        throw new ToolException(
            `MCP tool '${toolName}' on server '${serverName}' returned an error: ${result.content
                .map((content: CallToolResult['content'][0]) => content['text'])
                .join('\n')}`
        )
    }

    const convertedContent: (MessageContentComplex | DataContentBlock)[] = (
        await Promise.all(
            result.content.map((content) =>
                toolOutputToContentBlocks(
                    content,
                    useStandardContentBlocks,
                    client,
                    toolName,
                    serverName,
                    ctx
                )
            )
        )
    ).flat()

    if (convertedContent.length === 1 && convertedContent[0].type === 'text') {
        return [convertedContent[0].text, []]
    }

    return [convertedContent, []]
}
