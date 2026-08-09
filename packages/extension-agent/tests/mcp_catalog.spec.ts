import { expect } from 'chai'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { Context } from 'koishi'
import {
    createMcpCatalogSchemaResult,
    createMcpCatalogSummaryResult,
    McpCatalogTool,
    scoreMcpCatalogTool,
    validateMcpArguments
} from '../src/mcp/catalog'
import { ChatLunaAgentMcpService } from '../src/service/mcp'
import { AgentConfig } from '../src/types'

describe('MCP catalog', () => {
    it('ranks descriptions and exact tool ids', () => {
        const weather: McpCatalogTool = {
            name: 'get_weather',
            summary: 'Get city weather and rainfall',
            parameters: 'city (required): string',
            keywords: ['weather', 'forecast'],
            inputSchema: { type: 'object' }
        }
        const notes: McpCatalogTool = {
            name: 'create_note',
            summary: 'Create a study note',
            parameters: 'content (required): string',
            keywords: ['notes'],
            inputSchema: { type: 'object' }
        }

        expect(
            scoreMcpCatalogTool('weather', 'local', weather)
        ).to.be.greaterThan(scoreMcpCatalogTool('weather', 'local', notes))
        expect(
            scoreMcpCatalogTool('local/get_weather', 'local', weather)
        ).to.be.greaterThan(scoreMcpCatalogTool('weather', 'local', weather))
    })

    it('keeps schemas out of discovery results until explicitly loaded', () => {
        const tool: McpCatalogTool = {
            name: 'create_cards',
            summary: 'Create flashcards',
            parameters: 'notes (required): string',
            keywords: ['cards'],
            inputSchema: {
                type: 'object',
                required: ['notes'],
                properties: { notes: { type: 'string' } }
            }
        }

        const summary = createMcpCatalogSummaryResult('learning', tool)
        expect(summary).to.deep.equal({
            server: 'learning',
            name: 'create_cards',
            summary: 'Create flashcards',
            parameters: 'notes (required): string'
        })
        expect(summary).to.not.have.property('inputSchema')

        const schema = createMcpCatalogSchemaResult('learning', tool)
        expect(schema.inputSchema).to.deep.equal(tool.inputSchema)
    })

    it('returns structured nested validation and schema errors', () => {
        const validator = new AjvJsonSchemaValidator()
        const nested = validateMcpArguments(
            validator,
            {
                type: 'object',
                required: ['deck'],
                properties: {
                    deck: {
                        type: 'object',
                        required: ['cards'],
                        properties: {
                            cards: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    required: ['front'],
                                    properties: {
                                        front: { type: 'string' }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            { deck: { cards: [{}] } }
        )
        expect(nested.valid).to.equal(false)
        if (!nested.valid) {
            expect(nested.error).to.equal('validation_error')
            expect(nested.message).to.include('front')
        }

        const invalidSchema = validateMcpArguments(
            validator,
            { type: 'not-a-json-schema-type' },
            {}
        )
        expect(invalidSchema.valid).to.equal(false)
        if (!invalidSchema.valid) {
            expect(invalidSchema.error).to.equal('schema_error')
        }
    })

    it('waits for active calls before closing clients', async () => {
        let closed = false
        const service = new ChatLunaAgentMcpService(
            {} as Context,
            { mcp: { mcpServers: {}, tools: {} } } as AgentConfig,
            {} as never
        )
        const internals = service as unknown as McpInternals
        const client = {
            close: async () => {
                closed = true
            }
        } as Client

        internals._servers.set('local', {
            state: 'connected',
            attempts: 0,
            client
        })
        internals._beginActiveCall('local')

        const stopping = service.stop()
        await Promise.resolve()
        expect(closed).to.equal(false)

        internals._endActiveCall('local')
        await stopping
        expect(closed).to.equal(true)
    })

    it('waits for calls prepared by queued server operations', async () => {
        let closed = false
        const service = new ChatLunaAgentMcpService(
            {} as Context,
            { mcp: { mcpServers: {}, tools: {} } } as AgentConfig,
            {} as never
        )
        const internals = service as unknown as McpInternals
        const client = {
            close: async () => {
                closed = true
            }
        } as Client
        let prepare: () => void
        const queued = new Promise<void>((resolve) => {
            prepare = () => {
                internals._beginActiveCall('local')
                resolve()
            }
        })

        internals._servers.set('local', {
            state: 'connected',
            attempts: 0,
            client
        })
        internals._serverOperations.set('local', queued)

        const stopping = service.stop()
        prepare()
        await Promise.resolve()
        expect(closed).to.equal(false)

        internals._endActiveCall('local')
        await stopping
        expect(closed).to.equal(true)
    })

    it('closes clients after queued server operations fail', async () => {
        let closed = false
        const service = new ChatLunaAgentMcpService(
            {} as Context,
            { mcp: { mcpServers: {}, tools: {} } } as AgentConfig,
            {} as never
        )
        const internals = service as unknown as McpInternals
        const client = {
            close: async () => {
                closed = true
            }
        } as Client
        const failed = Promise.reject(new Error('expected failure'))
        failed.catch(() => {})

        internals._servers.set('local', {
            state: 'connected',
            attempts: 0,
            client
        })
        internals._serverOperations.set('local', failed)

        await service.stop()
        expect(closed).to.equal(true)
    })
})

type McpInternals = {
    _servers: Map<string, { state: string; attempts: number; client?: Client }>
    _beginActiveCall(name: string): void
    _endActiveCall(name: string): void
    _serverOperations: Map<string, Promise<void>>
}
