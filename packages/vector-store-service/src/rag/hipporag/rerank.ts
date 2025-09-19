/* eslint-disable max-len */
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { fixBrokenGeneratedJson, Triple } from './utils'
import {
    BaseMessage,
    HumanMessage,
    SystemMessage
} from '@langchain/core/messages'

interface DSPyFilterConfig {
    maxCompletionTokens?: number
    model?: string
}

/**
 * DSPy-style filter for reranking facts based on relevance to queries.
 * Implements the same logic as the Python DSPyFilter class.
 */
export class DSPyFilter {
    private llm: ChatLunaChatModel
    private config: DSPyFilterConfig
    private messageTemplate: BaseMessage[]
    private oneInputTemplate: string
    private oneOutputTemplate: string

    constructor(llm: ChatLunaChatModel, config: DSPyFilterConfig = {}) {
        this.llm = llm
        this.config = {
            maxCompletionTokens: 512,
            model: 'default',
            ...config
        }

        // Template for input formatting
        this.oneInputTemplate = `[[ ## question ## ]]
{question}

[[ ## fact_before_filter ## ]]
{fact_before_filter}

Respond with the corresponding output fields, starting with the field \`[[ ## fact_after_filter ## ]]\` (must be formatted as a valid Python Fact), and then ending with the marker for \`[[ ## completed ## ]]\`.`

        // Template for output formatting
        this.oneOutputTemplate = `[[ ## fact_after_filter ## ]]
{fact_after_filter}

[[ ## completed ## ]]`

        // System message template based on the Python implementation
        this.messageTemplate = this.makeTemplate()
    }

    private makeTemplate(): BaseMessage[] {
        const systemPrompt = `Your input fields are:
1. \`question\` (string): Query for retrieval
2. \`fact_before_filter\` (string): Candidate facts to be filtered

Your output fields are:
1. \`fact_after_filter\` (Fact): Filtered facts in JSON format

All interactions will be structured in the following way, with the appropriate values filled in.

[[ ## question ## ]]
{question}

[[ ## fact_before_filter ## ]]
{fact_before_filter}

[[ ## fact_after_filter ## ]]
{fact_after_filter}        # note: the value you produce must be parseable according to the following JSON schema: {"type": "object", "properties": {"fact": {"type": "array", "description": "A list of facts, each fact is a list of 3 strings: [subject, predicate, object]", "items": {"type": "array", "items": {"type": "string"}}, "title": "Fact"}}, "required": ["fact"], "title": "Fact"}

[[ ## completed ## ]]

In adhering to this structure, your objective is:
You are a critical component of a high-stakes question-answering system used by top researchers and decision-makers worldwide. Your task is to filter facts based on their relevance to a given query, ensuring that the most crucial information is presented to these stakeholders. The query requires careful analysis and possibly multi-hop reasoning to connect different pieces of information. You must select up to 4 relevant facts from the provided candidate list that have a strong connection to the query, aiding in reasoning and providing an accurate answer. The output should be in JSON format, e.g., {"fact": [["s1", "p1", "o1"], ["s2", "p2", "o2"]]}, and if no facts are relevant, return an empty list, {"fact": []}. The accuracy of your response is paramount, as it will directly impact the decisions made by these high-level stakeholders. You must only use facts from the candidate list and not generate new facts. The future of critical decision-making relies on your ability to accurately filter and present relevant information.`

        return [new SystemMessage(systemPrompt)]
    }

    /**
     * Parse the LLM response to extract filtered facts
     */
    private parseFilter(response: string): string[][] {
        try {
            const sections: [string | null, string[]][] = [[null, []]]
            const fieldHeaderPattern = /\[\[ ## (\w+) ## \]\]/

            const lines = response.split('\n')
            for (const line of lines) {
                const match = line.trim().match(fieldHeaderPattern)
                if (match) {
                    sections.push([match[1], []])
                } else {
                    sections[sections.length - 1][1].push(line)
                }
            }

            // Process sections and extract fact_after_filter
            for (const [key, valueLines] of sections) {
                if (key === 'fact_after_filter') {
                    const value = valueLines.join('\n').trim()
                    try {
                        // Try to parse as JSON
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        let parsedValue: any
                        try {
                            parsedValue = fixBrokenGeneratedJson(value)
                        } catch (jsonError) {
                            // If JSON parsing fails, try eval-like parsing
                            // This is a simplified version of ast.literal_eval
                            parsedValue = this.safeLiteralEval(value)
                        }

                        // Validate the structure matches Fact interface
                        if (
                            parsedValue &&
                            parsedValue.fact &&
                            Array.isArray(parsedValue.fact)
                        ) {
                            return parsedValue.fact.filter(
                                (fact) =>
                                    Array.isArray(fact) &&
                                    fact.length === 3 &&
                                    fact.every(
                                        (item) => typeof item === 'string'
                                    )
                            )
                        }
                    } catch (error) {
                        console.error(
                            `Error parsing field ${key}: ${error}. Value: ${value}`
                        )
                    }
                }
            }

            return []
        } catch (error) {
            console.error(`Error in parseFilter: ${error}`)
            return []
        }
    }

    /**
     * Safe literal evaluation for simple data structures
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private safeLiteralEval(value: string): any {
        try {
            // Remove whitespace and check for basic JSON-like structure
            const cleaned = value.trim()
            if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                return JSON.parse(cleaned)
            }
            return null
        } catch {
            return null
        }
    }

    /**
     * Make LLM call for fact filtering
     */
    private async llmCall(
        question: string,
        factBeforeFilter: string
    ): Promise<string> {
        try {
            const messages = [...this.messageTemplate]

            // Format the input message
            const userMessage = this.oneInputTemplate
                .replace('{question}', question)
                .replace('{fact_before_filter}', factBeforeFilter)

            messages.push(new HumanMessage(userMessage))

            // Call the LLM
            const response = await this.llm.invoke(messages, {
                maxTokens: this.config.maxCompletionTokens
            })

            return getMessageContent(response.content)
        } catch (error) {
            console.error(`Error in llmCall: ${error}`)
            throw error
        }
    }

    /**
     * Rerank facts based on relevance to the query.
     * This is the main method that implements the reranking logic.
     *
     * @param query - The query string
     * @param candidateItems - List of candidate facts (tuples)
     * @param candidateIndices - List of candidate indices
     * @param lenAfterRerank - Maximum number of facts to return after reranking
     * @returns Tuple of [sorted_indices, sorted_items, metadata]
     */
    async rerank(
        query: string,
        candidateItems: Triple[],
        candidateIndices: number[],
        lenAfterRerank?: number
    ): Promise<[number[], Triple[], { confidence?: number }]> {
        try {
            // Format facts for LLM input
            const factBeforeFilter = {
                fact: candidateItems.map((item) => Array.from(item))
            }

            // Call LLM for fact filtering
            const response = await this.llmCall(
                query,
                JSON.stringify(factBeforeFilter)
            )
            const generatedFacts = this.parseFilter(response)

            // Match generated facts back to candidate items using similarity
            const resultIndices: number[] = []

            for (const generatedFact of generatedFacts) {
                // Find the best match among candidate items
                let bestMatchIndex = -1
                let bestSimilarity = 0

                for (let i = 0; i < candidateItems.length; i++) {
                    const candidateItem = candidateItems[i]
                    const similarity = this.calculateFactSimilarity(
                        generatedFact,
                        Array.from(candidateItem)
                    )

                    if (similarity > bestSimilarity && similarity > 0.8) {
                        // Threshold for matching
                        bestSimilarity = similarity
                        bestMatchIndex = i
                    }
                }

                if (
                    bestMatchIndex !== -1 &&
                    !resultIndices.includes(bestMatchIndex)
                ) {
                    resultIndices.push(bestMatchIndex)
                }
            }

            // Apply length limit if specified
            const finalIndices = lenAfterRerank
                ? resultIndices.slice(0, lenAfterRerank)
                : resultIndices
            const sortedCandidateIndices = finalIndices.map(
                (i) => candidateIndices[i]
            )
            const sortedCandidateItems = finalIndices.map(
                (i) => candidateItems[i]
            )

            return [
                sortedCandidateIndices,
                sortedCandidateItems,
                { confidence: null }
            ]
        } catch (error) {
            console.error(`Error in rerank: ${error}`)
            return [[], [], { confidence: null }]
        }
    }

    /**
     * Calculate similarity between two facts (simple string matching)
     */
    private calculateFactSimilarity(fact1: string[], fact2: string[]): number {
        if (fact1.length !== fact2.length) return 0

        let matches = 0
        for (let i = 0; i < fact1.length; i++) {
            if (
                fact1[i].toLowerCase().trim() === fact2[i].toLowerCase().trim()
            ) {
                matches++
            }
        }

        return matches / fact1.length
    }

    /**
     * Alternative call interface for compatibility
     */
    async call(
        query: string,
        candidateItems: Triple[],
        candidateIndices: number[],
        lenAfterRerank?: number
    ): Promise<[number[], Triple[], { confidence?: number }]> {
        return this.rerank(
            query,
            candidateItems,
            candidateIndices,
            lenAfterRerank
        )
    }
}
