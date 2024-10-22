/* eslint-disable max-len */
import { StructuredTool } from '@langchain/core/tools'
import { Context, h, Session } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import { Config } from '..'
// eslint-disable-next-line @typescript-eslint/naming-convention
import { Result, Sandbox } from '@e2b/code-interpreter'
import { z } from 'zod'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.codeSandbox !== true) {
        return
    }

    plugin.registerTool('code', {
        selector(history) {
            return history.some(
                (message) =>
                    message.content != null &&
                    fuzzyQuery(getMessageContent(message.content), [
                        'exec ',
                        'code ',
                        'py ',
                        'python ',
                        'Python',
                        '函',
                        '数',
                        '绘',
                        'Jupyter',
                        'JavaScript',
                        'Help me',
                        'Draw',
                        'draw',
                        'sandbox',
                        'javascript ',
                        'nodejs ',
                        '代码',
                        '沙箱',
                        '执行',
                        '计算',
                        '运',
                        '行'
                    ])
            )
        },

        async createTool(params, session) {
            return new CodeSandBoxTool(ctx, config.codeSandboxAPIKey, session)
        }
    })
}

export class CodeSandBoxTool extends StructuredTool {
    name = 'code'

    schema = z.object({
        code: z.string({
            description: 'The python code to execute in a single cell.'
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any

    private interpreter: Sandbox

    constructor(
        private ctx: Context,
        private apiKey: string,
        private session: Session
    ) {
        super({})

        ctx.setInterval(
            async () => {
                await this.interpreter?.kill()
            },
            1000 * 60 * 30
        )
    }

    async _call(input: { code: string }) {
        const stderr: string[] = []

        const stdout: string[] = []
        try {
            const sandbox = await this.createSandBox()
            const exec = await sandbox.runCode(input.code, {
                onStderr(msg) {
                    stderr.push(msg.toString())
                },
                onStdout(msg) {
                    stdout.push(msg.toString())
                }
            })

            if (exec.error) {
                this.ctx.logger.error('[Code Interpreter error]', exec.error) // Runtime error
                return `Run failed with ${JSON.stringify(exec.logs)}`
            }

            this._sendResults(exec.results)

            return `Run successful`
        } catch (e) {
            return `sandbox failed to start, error: ${e.message}`
        }
    }

    async _sendResults(results: Result[]) {
        for (const result of results) {
            if (result.jpeg || result.png) {
                const buffer = Buffer.from(result.jpeg || result.png, 'base64')

                await this.session.send(
                    h.image(buffer, result.jpeg ? 'image/jpeg' : 'image/png')
                )

                continue
            }

            if (
                result.markdown ||
                result.javascript ||
                result.json ||
                result.html ||
                result.latex ||
                result.text ||
                result.svg
            ) {
                await this.session.send(
                    result.markdown ||
                        result.javascript ||
                        result.json ||
                        result.text ||
                        result.latex ||
                        result.text ||
                        result.svg
                )

                continue
            }

            if (result.pdf) {
                // base64 to buffer
                const buffer = Buffer.from(result.pdf, 'base64')

                await this.session.send(
                    h.file(buffer, 'application/octet-stream')
                )
                continue
            }
        }
    }

    async createSandBox(): Promise<Sandbox> {
        if (this.interpreter == null) {
            this.interpreter = await Sandbox.create({
                apiKey: this.apiKey
            })
        }

        return this.interpreter
    }

    description = `Execute python code in a Jupyter notebook cell and returns any result, stdout, stderr, display_data, and error. Don't put the any image in your final markdown response like this: [xx of xx](attachment://plot.png)`
}
