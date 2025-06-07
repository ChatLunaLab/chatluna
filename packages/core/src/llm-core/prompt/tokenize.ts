type Token = {
    type: 'text' | 'variable' | 'function'
    value: string
    args?: string[]
}

export function tokenize(input: string): Token[] {
    const tokens: Token[] = []
    let i = 0

    while (i < input.length) {
        // Find next opening brace
        const braceStart = input.indexOf('{', i)

        if (braceStart === -1) {
            // No more braces, add remaining text
            if (i < input.length) {
                tokens.push({ type: 'text', value: input.slice(i) })
            }
            break
        }

        // Add text before brace as text token
        if (braceStart > i) {
            tokens.push({ type: 'text', value: input.slice(i, braceStart) })
        }

        // Handle escaped braces {{...}}
        if (braceStart + 1 < input.length && input[braceStart + 1] === '{') {
            const endBraces = input.indexOf('}}', braceStart + 2)
            if (endBraces !== -1) {
                tokens.push({
                    type: 'text',
                    value: input.slice(braceStart, endBraces + 2)
                })
                i = endBraces + 2
                continue
            }
        }

        // Find matching closing brace (handling nested braces and strings)
        const braceEnd = findMatchingCloseBrace(input, braceStart)
        if (braceEnd === -1) {
            // No matching closing brace, treat as text
            tokens.push({ type: 'text', value: input[braceStart] })
            i = braceStart + 1
            continue
        }

        // Parse token content between braces
        const content = input.slice(braceStart + 1, braceEnd)
        const token = parseTokenContent(content)
        tokens.push(token)

        i = braceEnd + 1
    }

    return tokens
}

/**
 * Find the matching closing brace, properly handling nested braces and quoted strings
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
            // Inside string literal
            if (char === '\\' && i + 1 < input.length) {
                // Skip escaped character
                i++
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
 * Parse token content and return appropriate token
 * Supports: {variable}, {func:arg1::arg2}, {"string"::arg}, {func::"string"}
 */
function parseTokenContent(content: string): Token {
    const parts: string[] = []
    let i = 0

    while (i < content.length) {
        // Skip whitespace at the beginning
        while (i < content.length && /\s/.test(content[i])) {
            i++
        }

        if (i >= content.length) break

        let part = ''

        // Check if this part starts with a quote
        if (content[i] === '"' || content[i] === "'") {
            const quote = content[i]
            i++ // Skip opening quote

            // Parse quoted string with escape support
            while (i < content.length) {
                if (content[i] === '\\' && i + 1 < content.length) {
                    // Handle escape sequences
                    const nextChar = content[i + 1]
                    switch (nextChar) {
                        case 'n':
                            part += '\n'
                            break
                        case 't':
                            part += '\t'
                            break
                        case 'r':
                            part += '\r'
                            break
                        case 'b':
                            part += '\b'
                            break
                        case 'f':
                            part += '\f'
                            break
                        case 'v':
                            part += '\v'
                            break
                        case '0':
                            part += '\0'
                            break
                        case '\\':
                            part += '\\'
                            break
                        case '"':
                            part += '"'
                            break
                        case "'":
                            part += "'"
                            break
                        case '/':
                            part += '/'
                            break
                        default:
                            // For other characters, include the backslash
                            part += '\\' + nextChar
                            break
                    }
                    i += 2
                } else if (content[i] === quote) {
                    // End of quoted string
                    i++
                    break
                } else {
                    part += content[i]
                    i++
                }
            }
        } else {
            // Parse unquoted part
            while (i < content.length) {
                // Check for separator patterns
                if (content[i] === ':') {
                    if (i + 1 < content.length && content[i + 1] === ':') {
                        // Found '::' separator
                        break
                    } else if (parts.length === 0) {
                        // Found first ':' separator (function name separator)
                        break
                    }
                }

                // Handle +/- operators (legacy at start or as timezone offset)
                if (content[i] === '+' || content[i] === '-') {
                    if (part === '') {
                        // Legacy operators for first character
                        part += content[i]
                        i++
                        continue
                    } else if (parts.length === 0) {
                        // Found +/- after function name, treat as separator for timezone offset
                        break
                    }
                }

                part += content[i]
                i++
            }
        }

        // Add the parsed part
        if (part.trim()) {
            parts.push(part.trim())
        }

        // Skip separator
        if (i < content.length) {
            if (content[i] === ':') {
                if (i + 1 < content.length && content[i + 1] === ':') {
                    i += 2 // Skip '::'
                } else if (parts.length === 1) {
                    i++ // Skip first ':'
                }
            } else if (
                (content[i] === '+' || content[i] === '-') &&
                parts.length === 1
            ) {
                // Skip +/- timezone offset separator
                // Don't increment i here, let the sign be included in the next part
            }
        }
    }

    // Determine token type
    if (parts.length <= 1) {
        return {
            type: 'variable',
            value: parts[0] || content.trim()
        }
    } else {
        const [funcName, ...args] = parts
        return {
            type: 'function',
            value: funcName,
            args: args.filter((arg) => arg !== '')
        }
    }
}
