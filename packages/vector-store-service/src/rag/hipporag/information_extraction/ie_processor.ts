import { renderPromptTemplate } from '../prompt/PromptManager'
import {
    ChunkInfo,
    NerRawOutput,
    OpenIEResult,
    TripleRawOutput
} from '../utils/types'
import {
    extractNerFromResponse,
    extractTriplesFromResponse,
    filterInvalidTriples,
    fixBrokenGeneratedJson
} from '../utils/llm-utils'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'

/**
 * Information Extraction Processor for HippoRAG
 */
export class InformationExtractionProcessor {
    constructor(private llm: ChatLunaChatModel) {}

    /**
     * Named Entity Recognition (NER) extraction from a text passage
     */
    async ner(chunkKey: string, passage: string): Promise<NerRawOutput> {
        try {
            const messages = await renderPromptTemplate('ner', { passage })

            const rawResponse = await this.llm
                .invoke(messages)
                .then((message) => getMessageContent(message.content))

            const realResponse = processLLMResponse(rawResponse)
            const extractedEntities = extractNerFromResponse(realResponse)
            const uniqueEntities = [...new Set(extractedEntities)]

            return {
                chunkId: chunkKey,
                response: rawResponse,
                uniqueEntities,
                metadata: {
                    finish_reason: 'stop',
                    cache_hit: false
                }
            }
        } catch (error) {
            return {
                chunkId: chunkKey,
                response: '',
                uniqueEntities: [],
                metadata: {
                    error: String(error),
                    finish_reason: 'error',
                    cache_hit: false
                }
            }
        }
    }

    /**
     * Triple extraction from a text passage with named entities
     */
    async tripleExtraction(
        chunkKey: string,
        passage: string,
        namedEntities: string[]
    ): Promise<TripleRawOutput> {
        try {
            // Render the triple extraction prompt template
            const messages = await renderPromptTemplate('triple_extraction', {
                passage,
                named_entity_json: JSON.stringify({
                    named_entities: namedEntities
                })
            })

            const rawResponse = await this.llm
                .invoke(messages)
                .then((message) => getMessageContent(message.content))

            const realResponse = processLLMResponse(rawResponse)
            const extractedTriples = extractTriplesFromResponse(realResponse)
            const validTriples = filterInvalidTriples(extractedTriples)

            return {
                chunkId: chunkKey,
                response: rawResponse,
                metadata: {
                    finish_reason: 'stop',
                    cache_hit: false
                },
                triples: validTriples
            }
        } catch (error) {
            return {
                chunkId: chunkKey,
                response: '',
                metadata: {
                    error: String(error),
                    finish_reason: 'error',
                    cache_hit: false
                },
                triples: []
            }
        }
    }

    async openIE(chunkKey: string, passage: string): Promise<OpenIEResult> {
        const nerOutput = await this.ner(chunkKey, passage)
        const tripleOutput = await this.tripleExtraction(
            chunkKey,
            passage,
            nerOutput.uniqueEntities
        )

        return {
            ner: nerOutput,
            triplets: tripleOutput
        }
    }

    async batchOpenIE(
        chunks: Record<string, ChunkInfo>
    ): Promise<
        [Record<string, NerRawOutput>, Record<string, TripleRawOutput>]
    > {
        const chunkEntries = Object.entries(chunks)

        // Process NER for all chunks concurrently
        const nerPromises = chunkEntries.map(([chunkKey, chunkInfo]) =>
            this.ner(chunkKey, chunkInfo.content)
        )

        const nerResults = await Promise.all(nerPromises)
        const nerResultsDict = Object.fromEntries(
            nerResults.map((result) => [result.chunkId, result])
        )

        // Process triple extraction for all chunks concurrently
        const triplePromises = nerResults.map((nerResult) =>
            this.tripleExtraction(
                nerResult.chunkId,
                chunks[nerResult.chunkId].content,
                nerResult.uniqueEntities
            )
        )

        const tripleResults = await Promise.all(triplePromises)
        const tripleResultsDict = Object.fromEntries(
            tripleResults.map((result) => [result.chunkId, result])
        )

        return [nerResultsDict, tripleResultsDict]
    }
}

function processLLMResponse(rawResponse: string): string {
    try {
        JSON.parse(rawResponse)
        return rawResponse
    } catch {
        return fixBrokenGeneratedJson(rawResponse)
    }
}
