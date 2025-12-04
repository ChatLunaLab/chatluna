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
export declare function removeMarkdown(
    md: string,
    options?: RemoveMarkdownOptions
): string
export default removeMarkdown
