import { Triple } from './types'

/**
 * Strip trailing tokens (commas, colons, whitespace) but only when they are outside string contexts
 */
function stripTrailingTokensOutsideString(text: string): string {
    let inString = false
    let escapeNext = false
    let lastNonWhitespaceIndex = -1

    for (let i = 0; i < text.length; i++) {
        const char = text[i]

        if (escapeNext) {
            escapeNext = false
            lastNonWhitespaceIndex = i
            continue
        }

        if (char === '\\') {
            escapeNext = true
            lastNonWhitespaceIndex = i
            continue
        }

        if (char === '"' && !inString) {
            inString = true
            lastNonWhitespaceIndex = i
        } else if (char === '"' && inString) {
            inString = false
            lastNonWhitespaceIndex = i
        } else if (!inString) {
            // Outside string context
            if (!/[,:\s]/.test(char)) {
                lastNonWhitespaceIndex = i
            }
        } else {
            // Inside string context
            lastNonWhitespaceIndex = i
        }
    }

    return text.substring(0, lastNonWhitespaceIndex + 1)
}

/**
 * Remove trailing commas before closing braces/brackets but only when they are outside string contexts
 */
function stripTrailingCommasOutsideString(text: string): string {
    let result = ''
    let inString = false
    let escapeNext = false

    for (let i = 0; i < text.length; i++) {
        const char = text[i]

        if (escapeNext) {
            escapeNext = false
            result += char
            continue
        }

        if (char === '\\') {
            escapeNext = true
            result += char
            continue
        }

        if (char === '"' && !inString) {
            inString = true
            result += char
        } else if (char === '"' && inString) {
            inString = false
            result += char
        } else if (!inString && char === ',') {
            // Check if this comma is followed by whitespace and a closing brace/bracket
            let j = i + 1
            while (j < text.length && /\s/.test(text[j])) {
                j++
            }
            if (j < text.length && (text[j] === '}' || text[j] === ']')) {
                // Skip the comma (don't add it to result)
                continue
            } else {
                result += char
            }
        } else {
            result += char
        }
    }

    return result
}

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
        fixed = stripTrailingTokensOutsideString(fixed)

        // Always perform stack-based scan to balance brackets/braces and close strings
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

        // Close unclosed string if still in string state
        if (inString) {
            fixed += '"'
        }

        // Add missing closing characters for unmatched brackets/braces
        while (stack.length > 0) {
            const open = stack.pop()
            fixed += open === '{' ? '}' : ']'
        }

        // Remove trailing commas before closing braces/brackets
        fixed = stripTrailingCommasOutsideString(fixed)

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
