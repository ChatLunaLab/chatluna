export function parseRawModelName(modelName: string): [string, string] {
    if (modelName == null || modelName.trim().length < 1) {
        return [undefined, undefined]
    }

    return modelName.split(/(?<=^[^\/]+)\//) as [string, string]
}
