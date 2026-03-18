/** @module computer/proxy */

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
