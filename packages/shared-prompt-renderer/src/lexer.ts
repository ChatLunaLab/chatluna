import { Token } from './ast'
import { parseExpression } from './parser'

// LRU Cache for tokenization results
class LRUCache<K, V> {
    private cache = new Map<K, V>()
    private maxSize: number

    constructor(maxSize: number) {
        this.maxSize = maxSize
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key)
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key)
            this.cache.set(key, value)
        }
        return value
    }

    set(key: K, value: V): void {
        // Delete if exists
        this.cache.delete(key)

        // Add to end
        this.cache.set(key, value)

        // Evict oldest if over size
        if (this.cache.size > this.maxSize) {
            const firstKey = this.cache.keys().next().value
            this.cache.delete(firstKey)
        }
    }

    clear(): void {
        this.cache.clear()
    }
}

// Cache for tokenization (1000 most recent templates)
const tokenizeCache = new LRUCache<string, Token[]>(1000)

/**
 * Tokenize template string into AST nodes (with caching)
 * Supports:
 * - {expression} - Variable interpolation, function calls, member access
 * - {if condition}...{else}...{/if} - Conditional blocks
 * - {for item in list}...{/for} - Loop blocks
 * - {{...}} - Escaped braces (outputs as text)
 */
export function tokenize(input: string): Token[] {
    // Check cache
    const cached = tokenizeCache.get(input)
    if (cached) {
        return cached
    }

    // Tokenize
    const tokens = tokenizeInternal(input)

    // Cache result
    tokenizeCache.set(input, tokens)

    return tokens
}

/**
 * Clear tokenize cache (useful for testing or memory management)
 */
export function clearTokenizeCache(): void {
    tokenizeCache.clear()
}

function tokenizeInternal(input: string): Token[] {
    const tokens: Token[] = []
    let i = 0

    while (i < input.length) {
        const braceStart = input.indexOf('{', i)

        if (braceStart === -1) {
            // No more braces, add remaining text
            if (i < input.length) {
                tokens.push({ type: 'text', value: input.slice(i) })
            }
            break
        }

        // Add text before brace
        if (braceStart > i) {
            tokens.push({ type: 'text', value: input.slice(i, braceStart) })
        }

        // Handle escaped braces {{...}}
        if (braceStart + 1 < input.length && input[braceStart + 1] === '{') {
            const endBraces = input.indexOf('}}', braceStart + 2)
            if (endBraces !== -1) {
                tokens.push({
                    type: 'text',
                    value: input.slice(braceStart + 1, endBraces + 1)
                })
                i = endBraces + 2
                continue
            }
        }

        // Find matching closing brace
        const braceEnd = findMatchingCloseBrace(input, braceStart)
        if (braceEnd === -1) {
            tokens.push({ type: 'text', value: input[braceStart] })
            i = braceStart + 1
            continue
        }

        const content = input.slice(braceStart + 1, braceEnd).trim()

        // Parse control structures
        if (content.startsWith('if ')) {
            const result = parseIfBlock(input, braceStart, braceEnd)
            if (result) {
                tokens.push(result.token)
                i = result.endPosition
                continue
            }
        } else if (content.startsWith('for ')) {
            const result = parseForBlock(input, braceStart, braceEnd)
            if (result) {
                tokens.push(result.token)
                i = result.endPosition
                continue
            }
        }

        // Parse as expression
        try {
            const expression = parseExpression(content)
            tokens.push({ type: 'expression', expression })
        } catch (e) {
            // If parsing fails, treat as text
            tokens.push({
                type: 'text',
                value: input.slice(braceStart, braceEnd + 1)
            })
        }

        i = braceEnd + 1
    }

    return tokens
}

/**
 * Find matching closing brace, handling nested braces and strings
 */
function findMatchingCloseBrace(input: string, start: number): number {
    let depth = 1
    let i = start + 1
    let inString = false
    let stringDelim = ''

    while (i < input.length && depth > 0) {
        const char = input[i]

        if (!inString) {
            if (char === '"' || char === "'") {
                inString = true
                stringDelim = char
            } else if (char === '{') {
                depth++
            } else if (char === '}') {
                depth--
            }
        } else {
            if (char === '\\' && i + 1 < input.length) {
                i++ // Skip escaped character
            } else if (char === stringDelim) {
                inString = false
                stringDelim = ''
            }
        }

        i++
    }

    return depth === 0 ? i - 1 : -1
}

/**
 * Parse if block: {if condition}...{else}...{/if}
 */
function parseIfBlock(
    input: string,
    start: number,
    conditionEnd: number
): { token: Token; endPosition: number } | null {
    const conditionContent = input
        .slice(start + 1, conditionEnd)
        .trim()
        .slice(3)
        .trim()

    // Find {else} and {/if}
    let pos = conditionEnd + 1
    let depth = 1
    let elsePos = -1
    let endIfPos = -1

    while (pos < input.length && depth > 0) {
        const braceStart = input.indexOf('{', pos)
        if (braceStart === -1) break

        const braceEnd = findMatchingCloseBrace(input, braceStart)
        if (braceEnd === -1) break

        const tag = input.slice(braceStart + 1, braceEnd).trim()

        if (tag.startsWith('if ')) {
            depth++
        } else if (tag === '/if') {
            depth--
            if (depth === 0) {
                endIfPos = braceStart
                break
            }
        } else if (tag === 'else' && depth === 1 && elsePos === -1) {
            elsePos = braceStart
        }

        pos = braceEnd + 1
    }

    if (endIfPos === -1) return null

    const condition = parseExpression(conditionContent)

    let consequent: Token[]
    let alternate: Token[] | undefined

    if (elsePos !== -1) {
        consequent = tokenizeInternal(input.slice(conditionEnd + 1, elsePos))
        const elseEnd = findMatchingCloseBrace(input, elsePos)
        alternate = tokenizeInternal(input.slice(elseEnd + 1, endIfPos))
    } else {
        consequent = tokenizeInternal(input.slice(conditionEnd + 1, endIfPos))
    }

    const endIfEnd = findMatchingCloseBrace(input, endIfPos)

    return {
        token: { type: 'if', condition, consequent, alternate },
        endPosition: endIfEnd + 1
    }
}

/**
 * Parse for block: {for item in list}...{/for}
 */
function parseForBlock(
    input: string,
    start: number,
    headerEnd: number
): { token: Token; endPosition: number } | null {
    const headerContent = input
        .slice(start + 1, headerEnd)
        .trim()
        .slice(4)
        .trim()

    // Parse "item in list"
    const inIndex = headerContent.indexOf(' in ')
    if (inIndex === -1) return null

    const variable = headerContent.slice(0, inIndex).trim()
    const iterableContent = headerContent.slice(inIndex + 4).trim()

    // Find {/for}
    let pos = headerEnd + 1
    let depth = 1
    let endForPos = -1

    while (pos < input.length && depth > 0) {
        const braceStart = input.indexOf('{', pos)
        if (braceStart === -1) break

        const braceEnd = findMatchingCloseBrace(input, braceStart)
        if (braceEnd === -1) break

        const tag = input.slice(braceStart + 1, braceEnd).trim()

        if (tag.startsWith('for ')) {
            depth++
        } else if (tag === '/for') {
            depth--
            if (depth === 0) {
                endForPos = braceStart
                break
            }
        }

        pos = braceEnd + 1
    }

    if (endForPos === -1) return null

    const iterable = parseExpression(iterableContent)
    const body = tokenizeInternal(input.slice(headerEnd + 1, endForPos))
    const endForEnd = findMatchingCloseBrace(input, endForPos)

    return {
        token: { type: 'for', variable, iterable, body },
        endPosition: endForEnd + 1
    }
}
