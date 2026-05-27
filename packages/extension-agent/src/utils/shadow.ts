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
>(items: T[], preferRemote = false): (T & { shadowedBy?: string })[] {
    const groups = new Map<string, T[]>()

    for (const item of items) {
        const list = groups.get(item.name) ?? []
        list.push(item)
        groups.set(item.name, list)
    }

    const result: (T & { shadowedBy?: string })[] = []
    for (const list of groups.values()) {
        const valid = list.filter(
            (item) =>
                item.enabled !== false &&
                item.disabled !== true &&
                item.hidden !== true &&
                item.invalid !== true &&
                (item.state == null || item.state === 'ready') &&
                item.available !== false
        )

        valid.sort((a, b) => {
            if ((a.remote === true) !== (b.remote === true)) {
                return a.remote === true
                    ? preferRemote
                        ? -1
                        : 1
                    : preferRemote
                      ? 1
                      : -1
            }
            return a.priority - b.priority
        })

        const winner = valid[0]
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
