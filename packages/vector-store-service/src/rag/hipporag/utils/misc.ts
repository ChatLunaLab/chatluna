import { sleep } from 'koishi'
import { NerRawOutput, OpenIEDocument, Triple, TripleRawOutput } from './types'
import { createHash } from 'crypto'

/**
 * Compute MD5 hash ID for content with prefix
 * @param content Content to hash
 * @param prefix Prefix to add to hash
 * @returns Hash ID string
 */
export function computeMDHashId(content: string, prefix: string = ''): string {
    const hash = createHash('md5').update(content, 'utf-8').digest('hex')
    return prefix + hash
}

/**
 * Text processing function to clean and normalize text
 * @param text Text to process
 * @returns Cleaned text
 */
export function textProcessing<T extends string | string[]>(text: T): T {
    if (Array.isArray(text)) {
        return text.map((t) => textProcessing(t)) as T
    }

    // Basic text cleaning
    return text
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[^\w\s\-.,;:!?'"]/g, '') as T // Remove special characters except hyphens
}

/**
 * Extract entity nodes from chunk triples
 * @param chunkTriples Array of triple arrays for each chunk
 * @returns Object containing entity nodes and chunk triple entities
 */
export function extractEntityNodes(chunkTriples: Triple[][]): {
    entityNodes: string[]
    chunkTripleEntities: string[][]
} {
    const entityNodes = new Set<string>()
    const chunkTripleEntities: string[][] = []

    for (const triples of chunkTriples) {
        const chunkEntities = new Set<string>()

        for (const triple of triples) {
            if (triple.length >= 3) {
                const [subject, , object] = triple
                entityNodes.add(subject)
                entityNodes.add(object)
                chunkEntities.add(subject)
                chunkEntities.add(object)
            }
        }

        chunkTripleEntities.push(Array.from(chunkEntities))
    }

    return {
        entityNodes: Array.from(entityNodes),
        chunkTripleEntities
    }
}

/**
 * Flatten facts from nested structure
 * @param chunkTriples Array of triple arrays
 * @returns Flattened array of triples
 */
export function flattenFacts(chunkTriples: Triple[][]): Triple[] {
    const facts: Triple[] = []

    for (const triples of chunkTriples) {
        for (const triple of triples) {
            if (triple.length >= 3) {
                facts.push([triple[0], triple[1], triple[2]])
            }
        }
    }

    return facts
}

/**
 * Reformat OpenIE results into separate NER and triple dictionaries
 * @param openIEInfos Array of OpenIE documents
 * @returns Object containing formatted results
 */
export function reformatOpenIEResults(openIEInfos: OpenIEDocument[]): {
    nerResultsDict: Record<string, NerRawOutput>
    tripleResultsDict: Record<string, TripleRawOutput>
} {
    const nerResultsDict: Record<string, NerRawOutput> = {}
    const tripleResultsDict: Record<string, TripleRawOutput> = {}

    for (const doc of openIEInfos) {
        nerResultsDict[doc.idx] = {
            chunkId: doc.idx,
            response: null,
            metadata: {},
            uniqueEntities: doc.extractedEntities
        }

        tripleResultsDict[doc.idx] = {
            chunkId: doc.idx,
            response: null,
            metadata: {},
            triples: doc.extractedTriples
        }
    }

    return { nerResultsDict, tripleResultsDict }
}

/**
 * Min-max normalization of array
 * @param values Array of numbers to normalize
 * @returns Normalized array
 */
export function minMaxNormalize(values: number[]): number[] {
    if (values.length === 0) return []

    const min = Math.min(...values)
    const max = Math.max(...values)

    if (min === max) {
        return values.map(() => 1.0) // All values are the same
    }

    const range = max - min
    return values.map((value) => (value - min) / range)
}

/**
 * Batch process arrays into smaller chunks
 * @param array Array to batch
 * @param batchSize Size of each batch
 * @returns Array of batches
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
        throw new Error('batchSize must be a positive integer')
    }

    const batches: T[][] = []

    for (let i = 0; i < array.length; i += batchSize) {
        batches.push(array.slice(i, i + batchSize))
    }

    return batches
}

/**
 * Remove duplicates from array while preserving order
 * @param array Array with potential duplicates
 * @returns Array without duplicates
 */
export function removeDuplicates<T>(array: T[]): T[] {
    return Array.from(new Set(array))
}

/**
 * Check if two arrays are equal
 * @param arr1 First array
 * @param arr2 Second array
 * @returns True if arrays are equal
 */
export function arraysEqual<T>(arr1: T[], arr2: T[]): boolean {
    if (arr1.length !== arr2.length) {
        return false
    }

    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) {
            return false
        }
    }

    return true
}

/**
 * Deep clone an object
 * @param obj Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime()) as unknown as T
    }

    if (obj instanceof Array) {
        return obj.map((item) => deepClone(item)) as unknown as T
    }

    if (typeof obj === 'object') {
        const cloned = {} as T
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                cloned[key] = deepClone(obj[key])
            }
        }
        return cloned
    }

    return obj
}

/**
 * Safely parse JSON with fallback
 * @param jsonString JSON string to parse
 * @param fallback Fallback value if parsing fails
 * @returns Parsed object or fallback
 */
export function safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
        return JSON.parse(jsonString) as T
    } catch {
        return fallback
    }
}

/**
 * Retry function with exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param baseDelay Base delay in milliseconds
 * @returns Result of function or throws last error
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error as Error

            if (attempt === maxRetries) {
                throw lastError
            }

            // Exponential backoff with jitter
            const delay =
                baseDelay * Math.pow(2, attempt) + Math.random() * 1000
            await sleep(delay)
        }
    }

    throw lastError ?? new Error('Retry failed without captured error')
}

/**
 * Convert error to string safely
 * @param error Error object
 * @returns String representation of error
 */
export function errorToString(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }

    if (typeof error === 'string') {
        return error
    }

    try {
        return JSON.stringify(error)
    } catch {
        return String(error)
    }
}
