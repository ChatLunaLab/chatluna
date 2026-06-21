/** @module computer/session */

import { ComputerBackendType, ComputerSessionInfo } from '../types'
import { ComputerSessionApi } from './types'

export class ComputerSessionStore {
    private _items = new Map<
        string,
        {
            info: ComputerSessionInfo
            session: ComputerSessionApi
            active: number
        }
    >()

    private _creating = new Map<string, Promise<ComputerSessionApi>>()

    list() {
        return Array.from(this._items.values()).map((item) => ({
            ...item.info
        }))
    }

    get(key: string) {
        return this._items.get(key)?.session
    }

    getBySessionId(id: string) {
        return this._findBySessionId(id)?.session
    }

    getInfoBySessionId(id: string) {
        return this._findBySessionId(id)?.info
    }

    async getOrCreate(
        key: string,
        input: ComputerSessionKeyOptions,
        create: () => Promise<ComputerSessionApi>
    ) {
        const current = this._items.get(key)
        if (current) {
            current.info.lastActiveAt = Date.now()
            current.info.cwd = current.session.cwd
            return current.session
        }

        const pending = this._creating.get(key)
        if (pending) {
            const session = await pending
            const item = this._items.get(key)
            if (item) {
                item.info.lastActiveAt = Date.now()
                item.info.cwd = item.session.cwd
            }
            return session
        }

        const task = create()
            .then((session) => {
                const now = Date.now()

                this._items.set(key, {
                    info: {
                        id: session.sessionId,
                        backend: session.backend,
                        userId: input.userId,
                        conversationId: input.conversationId,
                        createdAt: now,
                        lastActiveAt: now,
                        cwd: session.cwd
                    },
                    session,
                    active: 0
                })

                return session
            })
            .finally(() => {
                this._creating.delete(key)
            })

        this._creating.set(key, task)
        return task
    }

    touchBySessionId(id: string) {
        const item = this._findBySessionId(id)
        if (!item) return
        item.info.lastActiveAt = Date.now()
        item.info.cwd = item.session.cwd
    }

    enterBySessionId(id: string) {
        const item = this._findBySessionId(id)
        if (!item) return

        item.active += 1
        item.info.lastActiveAt = Date.now()
        item.info.cwd = item.session.cwd
    }

    leaveBySessionId(id: string) {
        const item = this._findBySessionId(id)
        if (!item) return

        item.active = Math.max(0, item.active - 1)
        item.info.lastActiveAt = Date.now()
        item.info.cwd = item.session.cwd
    }

    isBusy(id: string) {
        return (this._findBySessionId(id)?.active ?? 0) > 0
    }

    async destroy(key: string) {
        const item = this._items.get(key)
        if (!item) return

        this._items.delete(key)
        await item.session.disconnect()
    }

    async destroyBySessionId(id: string) {
        const entry = Array.from(this._items.entries()).find(
            ([, item]) => item.info.id === id
        )
        if (entry) await this.destroy(entry[0])
    }

    async clear() {
        const items = Array.from(this._items.values())
        this._items.clear()
        await Promise.all(items.map((item) => item.session.disconnect()))
    }

    private _findBySessionId(id: string) {
        for (const item of this._items.values()) {
            if (item.info.id === id) return item
        }
        return undefined
    }
}

export function buildComputerSessionKey(opts: ComputerSessionKeyOptions) {
    if (opts.conversationId) {
        return `${opts.backend}:conversation:${opts.conversationId}`
    }

    if (opts.userId) {
        return `${opts.backend}:user:${opts.userId}`
    }

    return `${opts.backend}:default`
}

export interface ComputerSessionKeyOptions {
    backend: ComputerBackendType
    conversationId?: string
    userId?: string
}
