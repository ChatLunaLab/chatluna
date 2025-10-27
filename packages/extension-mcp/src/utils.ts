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
import { RunnableConfig } from '@langchain/core/runnables'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import {
    CallToolResult,
    EmbeddedResource,
    ReadResourceResult
} from '@modelcontextprotocol/sdk/types.js'
import { Context } from 'koishi'
import type {} from 'koishi-plugin-chatluna-storage-service'
import mimeTypes from 'mime-types'
import { logger } from '.'

/**
 **
 * Custom error class for tool exceptions
 */
export class ToolException extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ToolException'
    }
}

export function isToolException(error: unknown): error is ToolException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'ToolException'
    )
}

function isResourceReference(
    resource:
        | EmbeddedResource['resource']
        | ReadResourceResult['contents'][number]
) {
    return (
        typeof resource === 'object' &&
        resource !== null &&
        resource.uri != null &&
        resource.blob == null &&
        resource.text == null
    )
}

// eslint-disable-next-line generator-star-spacing, @typescript-eslint/naming-convention
async function* _embeddedResourceToStandardFileBlocks(
    resource:
        | EmbeddedResource['resource']
        | ReadResourceResult['contents'][number],
    client: Client
): AsyncGenerator<
    | (StandardFileBlock & Base64ContentBlock)
    | (StandardFileBlock & PlainTextContentBlock)
> {
    if (isResourceReference(resource)) {
        const response: ReadResourceResult = await client.readResource({
            uri: resource.uri
        })
        for (const content of response.contents) {
            yield* _embeddedResourceToStandardFileBlocks(content, client)
        }
        return
    }

    if (resource.blob != null) {
        yield {
            type: 'file',
            source_type: 'base64',
            data: resource.blob,
            mime_type: resource.mimeType,
            ...(resource.uri != null ? { metadata: { uri: resource.uri } } : {})
        } as StandardFileBlock & Base64ContentBlock
    }
    if (resource.text != null) {
        yield {
            type: 'file',
            source_type: 'text',
            mime_type: resource.mimeType,
            text: resource.text,
            ...(resource.uri != null ? { metadata: { uri: resource.uri } } : {})
        } as StandardFileBlock & PlainTextContentBlock
    }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
async function _toolOutputToContentBlocks(
    content: CallToolResult,
    useStandardContentBlocks: true,
    client: Client,
    toolName: string,
    serverName: string,
    ctx: Context
): Promise<DataContentBlock[]>
// eslint-disable-next-line @typescript-eslint/naming-convention
async function _toolOutputToContentBlocks(
    content: CallToolResult,
    useStandardContentBlocks: false | undefined,
    client: Client,
    toolName: string,
    serverName: string,
    ctx: Context
): Promise<MessageContentComplex[]>
// eslint-disable-next-line @typescript-eslint/naming-convention
async function _toolOutputToContentBlocks(
    content: CallToolResult,
    useStandardContentBlocks: boolean | undefined,
    client: Client,
    toolName: string,
    serverName: string,
    ctx: Context
): Promise<(MessageContentComplex | DataContentBlock)[]>
// eslint-disable-next-line @typescript-eslint/naming-convention
async function _toolOutputToContentBlocks(
    content: CallToolResult,
    useStandardContentBlocks: boolean | undefined,
    client: Client,
    toolName: string,
    serverName: string,
    ctx: Context
): Promise<(MessageContentComplex | DataContentBlock)[]> {
    const blocks: StandardFileBlock[] = []
    switch (content.type) {
        case 'text':
            return [
                {
                    type: 'text',
                    ...(useStandardContentBlocks
                        ? {
                              source_type: 'text'
                          }
                        : {}),
                    text: content.text
                } as MessageContentText
            ]
        case 'image': {
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

            const file = await putResourceToStorage(
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
        case 'audio':
            // We don't check `useStandardContentBlocks` here because we only support audio via
            // standard content blocks
            return [
                {
                    type: 'audio',
                    source_type: 'base64',
                    data: content.data,
                    mime_type: content.mimeType
                } as StandardAudioBlock
            ]
        case 'resource': {
            for await (const block of _embeddedResourceToStandardFileBlocks(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content['resource'] as any,
                client
            )) {
                blocks.push(block)
            }

            const textBlocks = await Promise.all(
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

                    return await putResourceToStorage(
                        ctx,
                        buffer,
                        value.mime_type
                    )
                })
            ).then((list) => list.filter(Boolean))

            if (textBlocks.length > 0) {
                return textBlocks.map((file) => ({
                    type: 'text',
                    text: `Resource url: ${file.url}. Please show to user`
                }))
            }

            return blocks
        }
        default:
            throw new ToolException(
                `MCP tool '${toolName}' on server '${serverName}' returned a content block with unexpected type "${
                    (content as { type: string }).type
                }." Expected one of "text", "image", or "audio".`
            )
    }
}

/* async function _embeddedResourceToArtifact(
    resource: EmbeddedResource,
    useStandardContentBlocks: boolean | undefined,
    client: Client,
    toolName: string,
    serverName: string
): Promise<(EmbeddedResource | DataContentBlock)[]> {
    if (useStandardContentBlocks) {
        return _toolOutputToContentBlocks(
            resource,
            useStandardContentBlocks,
            client,
            toolName,
            serverName
        )
    }

    if (!resource.blob && !resource.text && resource.uri) {
        const response: ReadResourceResult = await client.readResource({
            uri: resource.resource.uri
        })

        return response.contents.map(
            (content: ReadResourceResult['contents'][number]) => ({
                type: 'resource',
                resource: {
                    ...content
                }
            })
        )
    }

    return [resource]
}
 */
/**
 * @internal
 */
type ConvertCallToolResultArgs = {
    /**
     * The name of the server to call the tool on (used for error messages and logging)
     */
    serverName: string
    /**
     * The name of the tool that was called
     */
    toolName: string
    /**
     * The result from the MCP tool call
     */
    result: CallToolResult
    /**
     * The MCP client that was used to call the tool
     */
    client: Client
    /**
     * If true, the tool will use LangChain's standard multimodal content blocks for tools that output
     * image or audio content. This option has no effect on handling of embedded resource tool output.
     */
    useStandardContentBlocks?: boolean
}

/**
 * Process the result from calling an MCP tool.
 * Extracts text content and non-text content for better agent compatibility.
 *
 * @internal
 *
 * @param args - The arguments to pass to the tool
 * @returns A tuple of [textContent, nonTextContent]
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
async function _convertCallToolResult({
    serverName,
    toolName,
    result,
    client,
    useStandardContentBlocks,
    ctx
}: ConvertCallToolResultArgs & { ctx: Context }): Promise<
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
                .map((content: CallToolResult) => content.text)
                .join('\n')}`
        )
    }

    const convertedContent: (MessageContentComplex | DataContentBlock)[] = (
        await Promise.all(
            result.content
                /* .filter(
                    (content) =>
                        content.type === 'text' || content.type === 'image'
                ) */
                .map((content) =>
                    _toolOutputToContentBlocks(
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

    // Create the text content output
    /* const artifacts = (
        await Promise.all(
            (
                result.content.filter(
                    (content) =>
                        content.type === 'resource' ||
                        content.type === 'audio' ||
                        content.type === 'resource_link'
                ) as EmbeddedResource[]
            ).map((content: EmbeddedResource) => {
                return _embeddedResourceToArtifact(
                    content,
                    useStandardContentBlocks,
                    client,
                    toolName,
                    serverName
                )
            })
        )
    ).flat() */

    if (convertedContent.length === 1 && convertedContent[0].type === 'text') {
        return [convertedContent[0].text, []] // artifacts]
    }

    return [convertedContent, []] // artifacts]
}

/**
 * @internal
 */
type CallToolArgs = {
    /**
     * The name of the server to call the tool on (used for error messages and logging)
     */
    serverName: string
    /**
     * The name of the tool to call
     */
    toolName: string
    /**
     * The MCP client to call the tool on
     */
    client: Client
    /**
     * The arguments to pass to the tool - must conform to the tool's input schema
     */
    args: Record<string, unknown>
    /**
     * Optional RunnableConfig with timeout settings
     */
    config?: RunnableConfig
    /**
     * If true, the tool will use LangChain's standard multimodal content blocks for tools that output
     * image or audio content. This option has no effect on handling of embedded resource tool output.
     */
    useStandardContentBlocks?: boolean
}

/**
 * Call an MCP tool.
 *
 * Use this with `.bind` to capture the fist three arguments, then pass to the constructor of DynamicStructuredTool.
 *
 * @internal
 * @param args - The arguments to pass to the tool
 * @returns A tuple of [textContent, nonTextContent]
 */
export async function callTool({
    serverName,
    toolName,
    client,
    args,
    config,
    useStandardContentBlocks,
    ctx
}: CallToolArgs & { ctx: Context }): Promise<
    [
        (MessageContentComplex | DataContentBlock)[],
        (EmbeddedResource | DataContentBlock)[]
    ]
> {
    try {
        // Log MCP tool call input
        logger.debug(
            `Calling MCP tool '${toolName}' on server '${serverName}' with args:`,
            JSON.stringify(args, null, 2)
        )

        // Extract timeout from RunnableConfig and pass to MCP SDK
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
            callToolArgs.push(undefined) // optional output schema arg
            callToolArgs.push(requestOptions)
        }

        const result = await client.callTool(...callToolArgs)

        // Log MCP server response
        logger.debug(
            `MCP tool '${toolName}' on server '${serverName}' returned:`,
            JSON.stringify(result, null, 2)
        )

        return _convertCallToolResult({
            serverName,
            toolName,
            result: result as CallToolResult,
            client,
            useStandardContentBlocks,
            ctx
        })
    } catch (error) {
        if (isToolException(error)) {
            throw error
        }
        throw new ToolException(
            `Error calling tool ${toolName}: ${String(error)}`
        )
    }
}

async function putResourceToStorage(
    ctx: Context,
    blob: string | Buffer,
    mineType: string
) {
    if (!ctx.chatluna_storage) {
        return
    }

    const buffer = typeof blob === 'string' ? Buffer.from(blob, 'base64') : blob
    const extension = mimeTypes.extension(mineType)

    if (!extension) {
        throw new Error(`Unsupported mime type: ${mineType}`)
    }

    const fileName = `file.${extension}`
    return await ctx.chatluna_storage.createTempFile(buffer, fileName)
}
