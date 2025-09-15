export const chunkArray = <T>(arr: T[], chunkSize: number) =>
    arr.reduce((chunks, elem, index) => {
        const chunkIndex = Math.floor(index / chunkSize)
        const chunk = chunks[chunkIndex] || []
        // eslint-disable-next-line no-param-reassign
        chunks[chunkIndex] = chunk.concat([elem])
        return chunks
    }, [] as T[][])

export const splitArray = <T>(arr: T[], splitSize: number) => {
    if (!Number.isFinite(splitSize) || splitSize <= 0) {
        throw new RangeError('splitSize must be a positive integer')
    }
    if (arr.length === 0) return []
    return chunkArray(arr, Math.ceil(arr.length / splitSize))
}
