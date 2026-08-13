/** @module mcp/catalog */

import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { JsonSchemaType } from '@modelcontextprotocol/sdk/validation'

export type McpCatalogTool = {
    name: string
    summary: string
    parameters: string
    keywords: string[]
    inputSchema: Record<string, unknown>
}

export type McpCatalogSourceTool = {
    name: string
    title?: string
    description?: string
    inputSchema: Record<string, unknown>
}

export function createMcpCatalogTool(
    tool: McpCatalogSourceTool
): McpCatalogTool {
    const source = tool.inputSchema as {
        properties?: Record<string, { type?: string; description?: string }>
        required?: string[]
    }
    const required = new Set(source.required ?? [])
    const properties = Object.entries(source.properties ?? {})
    const parameters =
        properties.length === 0
            ? 'No parameters'
            : properties
                  .map(([name, info]) => {
                      const type = info.type ?? 'value'
                      const description = info.description
                          ? ` - ${info.description}`
                          : ''
                      return `${name}${required.has(name) ? ' (required)' : ''}: ${type}${description}`
                  })
                  .join('; ')
                  .slice(0, 200)

    return {
        name: tool.name,
        summary: (tool.description || `MCP tool ${tool.name}`)
            .trim()
            .slice(0, 200),
        parameters,
        keywords: Array.from(
            new Set(
                `${tool.name} ${tool.title ?? ''} ${tool.description ?? ''}`
                    .toLowerCase()
                    .split(/[^\p{L}\p{N}_-]+/u)
                    .filter(Boolean)
            )
        ).slice(0, 12),
        inputSchema: tool.inputSchema
    }
}

export function scoreMcpCatalogTool(
    query: string,
    server: string,
    tool: McpCatalogTool
) {
    const value = query.trim().toLowerCase()
    const text =
        `${server} ${tool.name} ${tool.summary} ${tool.parameters} ${tool.keywords.join(' ')}`.toLowerCase()
    let score = text.includes(value) ? 100 : 0

    for (const word of value
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((item) => item.length > 1)) {
        if (text.includes(word)) score += 10
    }

    const compact = value.replace(/\s+/g, '')
    for (let i = 0; i < compact.length - 1; i++) {
        if (text.includes(compact.slice(i, i + 2))) score++
    }

    if (`${server}/${tool.name}`.toLowerCase() === value) score += 200
    return score > 1 ? score : 0
}

export function createMcpCatalogSummaryResult(
    server: string,
    tool: McpCatalogTool
) {
    return {
        server,
        name: tool.name,
        summary: tool.summary,
        parameters: tool.parameters
    }
}

export function createMcpCatalogSchemaResult(
    server: string,
    tool: McpCatalogTool
) {
    return {
        ...createMcpCatalogSummaryResult(server, tool),
        inputSchema: tool.inputSchema
    }
}

export function validateMcpArguments(
    validator: AjvJsonSchemaValidator,
    schema: Record<string, unknown>,
    args: Record<string, unknown>
): McpArgumentValidation {
    try {
        const result = validator.getValidator<Record<string, unknown>>(
            schema as JsonSchemaType
        )(args)
        if (!result.valid) {
            return {
                valid: false,
                error: 'validation_error',
                message: result.errorMessage
            }
        }
        return { valid: true, data: result.data }
    } catch (error) {
        return {
            valid: false,
            error: 'schema_error',
            message: error instanceof Error ? error.message : String(error)
        }
    }
}

export type McpArgumentValidation =
    | { valid: true; data: Record<string, unknown> }
    | {
          valid: false
          error: 'validation_error' | 'schema_error'
          message: string
      }
