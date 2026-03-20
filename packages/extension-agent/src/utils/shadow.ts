/**
 * @module utils/shadow
 * @description 同名项目的遮蔽规则处理。
 */

export function applyShadowing<
    T extends {
        name: string
        id: string
        enabled?: boolean
        disabled?: boolean
        hidden?: boolean
        invalid?: boolean
        state?: string
        available?: boolean
        priority: number
        remote?: boolean
    }
>(items: T[]): (T & { shadowedBy?: string })[] {
    const groups = new Map<string, T[]>()

    for (const item of items) {
        const list = groups.get(item.name) ?? []
        list.push(item)
        groups.set(item.name, list)
    }

    const result: (T & { shadowedBy?: string })[] = []
    for (const list of groups.values()) {
        const candidates = list.filter((item) => {
            if (item.enabled === false) return false
            if (item.disabled === true) return false
            if (item.hidden === true) return false
            if (item.invalid === true) return false
            if (item.state != null && item.state !== 'ready') return false
            return item.available !== false
        })

        candidates.sort((a, b) => {
            if ((a.remote === true) !== (b.remote === true)) {
                return a.remote === true ? 1 : -1
            }

            return a.priority - b.priority
        })
        const winner = candidates[0]

        for (const item of list) {
            result.push({
                ...item,
                shadowedBy:
                    winner && winner.id !== item.id ? winner.id : undefined
            })
        }
    }

    return result
}
