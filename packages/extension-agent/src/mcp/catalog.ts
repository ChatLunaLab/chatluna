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

/**
 * Create a catalog entry from an MCP tool definition by parsing its schema.
 * @param tool - The source MCP tool definition
 * @returns A catalog entry with summary, parameters, and keywords
 */
export function createMcpCatalogTool(
    tool: McpCatalogSourceTool
): McpCatalogTool {
    return {
        name: tool.name,
        summary: (tool.description || `MCP tool ${tool.name}`)
            .trim()
            .slice(0, 200),
        parameters: formatParameters(tool.inputSchema),
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

/**
 * Score a tool's relevance to a search query using keyword matching.
 * @param query - The search query
 * @param server - The server name
 * @param tool - The catalog tool to score
 * @returns A relevance score (higher is better, 0 means no match)
 */
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
    return score
}

/**
 * Create a compact summary result for search results (without inputSchema).
 * @param server - The server name
 * @param tool - The catalog tool
 * @returns A summary object with server, name, summary, and parameters
 */
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

/**
 * Create a full schema result including inputSchema for tool invocation.
 * @param server - The server name
 * @param tool - The catalog tool
 * @returns A complete tool definition with inputSchema
 */
export function createMcpCatalogSchemaResult(
    server: string,
    tool: McpCatalogTool
) {
    return {
        ...createMcpCatalogSummaryResult(server, tool),
        inputSchema: tool.inputSchema
    }
}

/**
 * Validate tool arguments against an inputSchema using AJV validator.
 * @param validator - The AJV schema validator instance
 * @param schema - The JSON schema to validate against
 * @param args - The arguments to validate
 * @returns Validation result with data or error details
 */
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

/**
 * Format JSON schema properties into a human-readable parameter description.
 * @param schema - The JSON schema object
 * @returns A formatted string describing parameters
 */
function formatParameters(schema: Record<string, unknown>) {
    const source = schema as {
        properties?: Record<string, { type?: string; description?: string }>
        required?: string[]
    }
    const required = new Set(source.required ?? [])
    const properties = Object.entries(source.properties ?? {})
    if (properties.length === 0) return 'No parameters'

    return properties
        .map(([name, info]) => {
            const type = info.type ?? 'value'
            const description = info.description ? ` - ${info.description}` : ''
            return `${name}${required.has(name) ? ' (required)' : ''}: ${type}${description}`
        })
        .join('; ')
        .slice(0, 200)
}
