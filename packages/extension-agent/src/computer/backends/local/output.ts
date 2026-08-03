import { createWriteStream, type WriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TextOutput } from '../../types'
import { logger } from '../../..'

const OUTPUT_FILE_PREFIX = '.tmp-chatluna-'

export class LocalOutputCollector {
    private _text = ''

    private _length = 0

    private _count = 0

    private _path?: string

    private _stream?: WriteStream

    private _error?: Error

    private _pending = Promise.resolve()

    private _result?: Promise<TextOutput>

    constructor(
        private readonly _name: string,
        private readonly _limit = 8000
    ) {}

    get count() {
        return this._count
    }

    append(text: string) {
        if (this._result) return Promise.reject(new Error('Output is finished'))
        const task = this._pending.then(async () => {
            const length = this._length + text.length
            if (!this._stream && length <= this._limit) {
                this._text += text
                this._length = length
                return
            }

            if (!this._stream) {
                this._path = path.join(
                    os.tmpdir(),
                    `${OUTPUT_FILE_PREFIX}${this._name}-${Date.now()}-${randomUUID()}.txt`
                )
                this._stream = createWriteStream(this._path, {
                    encoding: 'utf8',
                    mode: 0o600
                })
                this._stream.on('error', (err) => {
                    this._error = err
                })
                await this._write(this._text)
            }

            if (this._text.length < this._limit) {
                this._text += text.slice(0, this._limit - this._text.length)
            }
            this._length = length
            await this._write(text)
        })
        this._pending = task
        return task
    }

    appendLine(text: string) {
        this._count += 1
        return this.append(`${this._count > 1 ? '\n' : ''}${text}`)
    }

    finish() {
        this._result ??= this._pending.then(async () => {
            if (!this._stream) {
                return {
                    text: this._text,
                    totalLength: this._length,
                    count: this._count
                }
            }

            if (!this._stream.closed) {
                await new Promise<void>((resolve, reject) => {
                    this._stream!.once('close', () => {
                        if (this._error) reject(this._error)
                        else resolve()
                    })
                    this._stream!.end()
                })
            }
            if (this._error) throw this._error
            return {
                text: this._text,
                outputPath: this._path,
                totalLength: this._length,
                count: this._count
            }
        })
        return this._result
    }

    async dispose() {
        await this._pending.catch(() => undefined)
        if (this._stream && !this._stream.closed) {
            await new Promise<void>((resolve) => {
                this._stream!.once('close', resolve)
                this._stream!.destroy()
            })
        }
        if (this._path) await fs.rm(this._path, { force: true })
    }

    private async _write(text: string) {
        await new Promise<void>((resolve, reject) => {
            this._stream!.write(text, (err) => {
                if (err) reject(err)
                else resolve()
            })
        })
    }
}

export async function cleanupExpiredOutputs(maxAgeMs: number) {
    const dir = os.tmpdir()
    let entries: string[]
    try {
        entries = await fs.readdir(dir)
    } catch (err) {
        logger.warn(`Failed to list temp directory for output cleanup: ${err}`)
        return
    }
    const cutoff = Date.now() - maxAgeMs
    await Promise.all(
        entries
            .filter((name) => name.startsWith(OUTPUT_FILE_PREFIX))
            .map(async (name) => {
                const file = path.join(dir, name)
                try {
                    const stat = await fs.stat(file)
                    if (stat.mtimeMs < cutoff) {
                        await fs.rm(file, { force: true })
                    }
                } catch (err) {
                    logger.warn(
                        `Failed to clean up temporary output ${file}: ${err}`
                    )
                }
            })
    )
}
