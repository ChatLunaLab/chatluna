/** @module computer/proxy */

import { Readable } from 'stream'
import { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import { Context } from 'koishi'
import type { ChatLunaAgentComputerService } from '../service/computer'
import type { WebSocketLayer } from '@koishijs/plugin-server'

export class ChatLunaAgentComputerProxy {
    private _terminalLayer?: WebSocketLayer

    constructor(
        private ctx: Context,
        private service: ChatLunaAgentComputerService
    ) {}

    start() {
        if (!this.ctx.server) {
            return
        }

        this.ctx.server.get(
            '/chatluna/computer/preview/:sessionId/:port(\\d+)',
            async (koa) => this.handlePreview(koa, '')
        )
        this.ctx.server.get(
            '/chatluna/computer/preview/:sessionId/:port(\\d+)/:rest(.*)',
            async (koa) => this.handlePreview(koa, koa.params.rest || '')
        )

        this._terminalLayer = this.ctx.server.ws(
            /^\/chatluna\/computer\/terminal\/([^/]+)\/([^/]+)$/,
            (socket, request) => {
                this.acceptTerminal(socket, request).catch((err) => {
                    this.ctx.logger.warn(
                        `Failed to proxy terminal websocket: ${err instanceof Error ? err.message : String(err)}`
                    )
                    socket.close()
                })
            }
        )
    }

    stop() {
        this._terminalLayer?.close()
        this._terminalLayer = undefined
    }

    private async handlePreview(koa: PreviewContext, rest: string) {
        const session = this.service.getSession(koa.params.sessionId)
        if (!session) {
            koa.status = 404
            koa.body = 'Computer session not found.'
            return
        }

        this.service.touchSession(session.sessionId)

        const port = Number(koa.params.port)
        const allowed = await this.service.canPreviewPort(
            session.sessionId,
            port
        )
        if (!allowed) {
            koa.status = 403
            koa.body = 'Port preview is not allowed.'
            return
        }

        const target = this.service.resolvePreviewTarget(
            session.sessionId,
            port,
            rest,
            String(koa.querystring || '')
        )
        if (!target) {
            koa.status = 404
            koa.body = 'Preview target is not available.'
            return
        }

        const response = await fetch(target, {
            method: koa.method,
            headers: forwardHeaders(koa.headers),
            body:
                koa.method === 'GET' || koa.method === 'HEAD'
                    ? undefined
                    : (Readable.toWeb(koa.req) as ReadableStream<Uint8Array>)
        })

        koa.status = response.status
        response.headers.forEach((value, key) => {
            if (key === 'content-encoding') {
                return
            }
            koa.set(key, value)
        })

        koa.body = response.body
            ? Readable.fromWeb(response.body as ReadableStream<Uint8Array>)
            : null
    }

    private async acceptTerminal(socket: WebSocket, request: IncomingMessage) {
        const match = request.url?.match(
            /^\/chatluna\/computer\/terminal\/([^/]+)\/([^/]+)$/
        )
        if (!match) {
            socket.close()
            return
        }

        const terminal = this.service.getTerminal(match[1], match[2])
        if (!terminal) {
            socket.close()
            return
        }

        this.service.touchSession(match[1])

        terminal.onData((data) => {
            if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify({ type: 'data', data }))
            }
        })

        socket.on('message', (chunk) => {
            const text = Buffer.isBuffer(chunk)
                ? chunk.toString('utf8')
                : String(chunk)
            try {
                const data = JSON.parse(text)
                if (data.type === 'input') {
                    terminal.sendInput(String(data.data ?? ''))
                    return
                }
                if (data.type === 'resize') {
                    terminal.resize(
                        Number(data.cols) || 80,
                        Number(data.rows) || 24
                    )
                    return
                }
                if (data.type === 'kill') {
                    terminal.kill()
                }
            } catch {
                terminal.sendInput(text)
            }
        })

        socket.on('close', () => {
            this.service.closeTerminal(match[1], match[2]).catch(() => {})
        })
    }
}

function forwardHeaders(
    headers: Record<string, string | string[] | undefined>
) {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) {
            continue
        }
        if (Array.isArray(value)) {
            result[key] = value.join(', ')
            continue
        }
        result[key] = value
    }
    return result
}

type PreviewContext = Parameters<Parameters<Context['server']['get']>[1]>[0]
