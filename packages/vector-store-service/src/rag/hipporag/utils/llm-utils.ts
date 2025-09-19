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
        let fixed = rawResponse.trim()

        // If the response is truncated and missing closing braces/brackets
        if (!fixed.endsWith('}') && !fixed.endsWith(']')) {
            // Count open braces and brackets to determine what's missing
            const openBraces = (fixed.match(/\{/g) || []).length
            const closeBraces = (fixed.match(/\}/g) || []).length
            const openBrackets = (fixed.match(/\[/g) || []).length
            const closeBrackets = (fixed.match(/\]/g) || []).length

            // Add missing closing brackets
            for (let i = 0; i < openBrackets - closeBrackets; i++) {
                fixed += ']'
            }

            // Add missing closing braces
            for (let i = 0; i < openBraces - closeBraces; i++) {
                fixed += '}'
            }
        }

        // Try to remove trailing commas
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1')

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
