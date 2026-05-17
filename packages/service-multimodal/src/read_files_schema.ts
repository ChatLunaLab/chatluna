import z from 'zod'

const READ_FILE_SCHEMA = z.object({
    url: z.string().url()
})

function parseJsonStringInput(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value
    }

    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

export const readFilesInputSchema = z.object({
    files: z
        .preprocess(
            parseJsonStringInput,
            z.union([
                READ_FILE_SCHEMA,
                z.array(READ_FILE_SCHEMA).min(1).max(10)
            ])
        )
        .describe(
            'One file or a list of files to read (max 10). File format: { url: string }. MIME type is inferred from response headers, then URL extension.'
        )
})
