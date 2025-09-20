import { Triple } from './types'

/**
 * Fix broken JSON output from LLM when response is truncated due to length limits
 */
export function fixBrokenGeneratedJson(rawResponse: string): string {
    rawResponse = rawResponse.replace(
        /```(?:json|javascript|js)?\s*([\s\S]*?)```/g,
        '$1'
    )

    try {
        // Try to parse as-is first
        JSON.parse(rawResponse)
        return rawResponse
    } catch {
        // If parsing fails, try to fix common issues

        // If parsing fails, try to fix common issues
        let fixed = rawResponse.trim()
        fixed = fixed.replace(/[,:\s]+$/, '')

        // If the response is truncated and missing closing braces/brackets
        if (!fixed.endsWith('}') && !fixed.endsWith(']')) {
            // More sophisticated bracket/brace counting that ignores strings
            const stack: string[] = []
            let inString = false
            let escapeNext = false

            for (const char of fixed) {
                if (escapeNext) {
                    escapeNext = false
                    continue
                }
                if (char === '\\') {
                    escapeNext = true
                    continue
                }
                if (char === '"' && !inString) {
                    inString = true
                } else if (char === '"' && inString) {
                    inString = false
                } else if (!inString) {
                    if (char === '{' || char === '[') {
                        stack.push(char)
                    } else if (char === '}' || char === ']') {
                        const expected = char === '}' ? '{' : '['
                        if (stack[stack.length - 1] === expected) {
                            stack.pop()
                        }
                    }
                }
            }

            // Add missing closing characters
            while (stack.length > 0) {
                const open = stack.pop()
                fixed += open === '{' ? '}' : ']'
            }
        }

        // Try to remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1')

        // Validate the fixed JSON
        try {
            JSON.parse(fixed)
        } catch {
            // If still invalid, return original for debugging
            console.warn('Failed to fix JSON:', rawResponse)
            return rawResponse
        }

        return fixed
    }
}

/**
 * Filter invalid triples - ensure each triple has exactly 3 non-empty elements
 */
export function filterInvalidTriples(triples: Triple[]): Triple[] {
    return triples.filter((triple): triple is Triple => {
        return (
            Array.isArray(triple) &&
            triple.length === 3 &&
            triple.every(
                (item) => typeof item === 'string' && item.trim().length > 0
            )
        )
    })
}

/**
 * Extract named entities from LLM response using regex pattern
 */
export function extractNerFromResponse(realResponse: string): string[] {
    const pattern = /\{[^{}]*"named_entities"\s*:\s*\[[^\]]*\][^{}]*\}/
    const match = realResponse.match(pattern)

    if (!match) {
        return []
    }

    try {
        const parsed = JSON.parse(match[0])
        return Array.isArray(parsed.named_entities) ? parsed.named_entities : []
    } catch {
        return []
    }
}

/**
 * Extract triples from LLM response using regex pattern
 */
export function extractTriplesFromResponse(realResponse: string): Triple[] {
    const pattern = /\{[^{}]*"triples"\s*:\s*\[[^\]]*\][^{}]*\}/
    const match = realResponse.match(pattern)

    if (!match) {
        return []
    }

    try {
        const parsed = JSON.parse(match[0])
        return Array.isArray(parsed.triples) ? parsed.triples : []
    } catch {
        return []
    }
}
