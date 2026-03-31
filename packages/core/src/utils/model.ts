export function parseRawModelName(
    modelName: string
): [string | undefined, string | undefined] {
    if (modelName == null || modelName.trim().length < 1) {
        return [undefined, undefined]
    }

    const value = modelName.trim()
    const index = value.indexOf('/')

    if (index === -1) {
        return [undefined, value]
    }

    if (index === 0 || index === value.length - 1) {
        return [undefined, undefined]
    }

    return [value.slice(0, index), value.slice(index + 1)]
}
