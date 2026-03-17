/** @module mcp/types */

export class ToolException extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ToolException'
    }
}

export function isToolException(error: unknown): error is ToolException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'ToolException'
    )
}
