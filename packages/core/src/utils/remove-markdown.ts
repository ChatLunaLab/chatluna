export interface RemoveMarkdownOptions {
    listUnicodeChar?: boolean
    stripListLeaders?: boolean
    gfm?: boolean
    useImgAltText?: boolean
    abbr?: boolean
    replaceLinksWithURL?: boolean
    htmlTagsToSkip?: string[]
    throwError?: boolean
}

export function removeMarkdown(
    md: string,
    options: RemoveMarkdownOptions = {}
): string {
    options.listUnicodeChar = Object.prototype.hasOwnProperty.call(
        options,
        'listUnicodeChar'
    )
        ? options.listUnicodeChar
        : false
    options.stripListLeaders = Object.prototype.hasOwnProperty.call(
        options,
        'stripListLeaders'
    )
        ? options.stripListLeaders
        : true
    options.gfm = Object.prototype.hasOwnProperty.call(options, 'gfm')
        ? options.gfm
        : true
    options.useImgAltText = Object.prototype.hasOwnProperty.call(
        options,
        'useImgAltText'
    )
        ? options.useImgAltText
        : true
    options.abbr = Object.prototype.hasOwnProperty.call(options, 'abbr')
        ? options.abbr
        : false
    options.replaceLinksWithURL = Object.prototype.hasOwnProperty.call(
        options,
        'replaceLinksWithURL'
    )
        ? options.replaceLinksWithURL
        : false
    options.htmlTagsToSkip = Object.prototype.hasOwnProperty.call(
        options,
        'htmlTagsToSkip'
    )
        ? options.htmlTagsToSkip
        : []
    options.throwError = Object.prototype.hasOwnProperty.call(
        options,
        'throwError'
    )
        ? options.throwError
        : false

    let output = md || ''

    // Remove horizontal rules (stripListHeaders conflict with this rule, which is why it has been moved to the top)
    output = output.replace(
        /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/gm,
        ''
    )

    try {
        if (options.stripListLeaders) {
            if (options.listUnicodeChar)
                output = output.replace(
                    /^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm,
                    options.listUnicodeChar + ' $1'
                )
            else
                output = output.replace(/^([\s\t]*)([\*\-\+]|\d+\.)\s+/gm, '$1')
        }
        if (options.gfm) {
            output = output
                // Header
                .replace(/\n={2,}/g, '\n')
                // Fenced codeblocks
                .replace(/~{3}.*\n/g, '')
                // Strikethrough
                .replace(/~~/g, '')
                // Fenced codeblocks with backticks
                .replace(/```(?:.*)\n([\s\S]*?)```/g, (_, code) => code.trim())
        }
        if (options.abbr) {
            // Remove abbreviations
            output = output.replace(/\*\[.*\]:.*\n/, '')
        }

        let htmlReplaceRegex = /<[^>]*>/g
        if (options.htmlTagsToSkip && options.htmlTagsToSkip.length > 0) {
            // Create a regex that matches tags not in htmlTagsToSkip
            const joinedHtmlTagsToSkip = options.htmlTagsToSkip.join('|')
            htmlReplaceRegex = new RegExp(
                `<(?!\/?(${joinedHtmlTagsToSkip})(?=>|\s[^>]*>))[^>]*>`,
                'g'
            )
        }

        output = output
            // Remove HTML tags
            .replace(htmlReplaceRegex, '')
            // Remove setext-style headers
            .replace(/^[=\-]{2,}\s*$/g, '')
            // Remove footnotes?
            .replace(/\[\^.+?\](\: .*?$)?/g, '')
            .replace(/\s{0,2}\[.*?\]: .*?$/g, '')
            // Remove images
            .replace(
                /\!\[(.*?)\][\[\(].*?[\]\)]/g,
                options.useImgAltText ? '$1' : ''
            )
            // Remove inline links
            .replace(
                /\[([\s\S]*?)\]\s*[\(\[].*?[\)\]]/g,
                options.replaceLinksWithURL ? '$2' : '$1'
            )
            // Remove blockquotes
            .replace(/^(\n)?\s{0,3}>\s?/gm, '$1')
            // .replace(/(^|\n)\s{0,3}>\s?/g, '\n\n')
            // Remove reference-style links?
            .replace(/^\s{1,2}\[(.*?)\]: (\S+)( ".*?")?\s*$/g, '')
            // Remove atx-style headers
            .replace(
                /^(\n)?\s{0,}#{1,6}\s*( (.+))? +#+$|^(\n)?\s{0,}#{1,6}\s*( (.+))?$/gm,
                '$1$3$4$6'
            )
            // Remove * emphasis
            .replace(/([\*]+)(\S)(.*?\S)??\1/g, '$2$3')
            // Remove _ emphasis. Unlike *, _ emphasis gets rendered only if
            //   1. Either there is a whitespace character before opening _ and after closing _.
            //   2. Or _ is at the start/end of the string.
            .replace(/(^|\W)([_]+)(\S)(.*?\S)??\2($|\W)/g, '$1$3$4$5')
            // Remove single-line code blocks (already handled multiline above in gfm section)
            .replace(/(`{3,})(.*?)\1/gm, '$2')
            // Remove inline code
            .replace(/`(.+?)`/g, '$1')
            // Replace strike through
            .replace(/~(.*?)~/g, '$1')
    } catch (e) {
        if (options.throwError) throw e

        console.error('remove-markdown encountered error: %s', e)
        return md
    }
    return output
}

export default removeMarkdown
