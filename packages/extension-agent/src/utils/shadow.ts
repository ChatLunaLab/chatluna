/**
 * @module utils/shadow
 * @description 同名项目的遮蔽规则处理。
 */

export function applyShadowing<
    T extends {
        name: string
        id: string
        enabled: boolean
        state: string
        priority: number
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
        list.sort((a, b) => a.priority - b.priority)
        const winner = list.find(
            (item) => item.enabled && item.state === 'ready'
        )

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
