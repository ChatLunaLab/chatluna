/* eslint-disable max-len */
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
import { Triple } from './utils'
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
 * A robust filter for reranking facts based on relevance to a query using an LLM.
 * This implementation instructs the LLM to return the indices of relevant facts,
 * ensuring efficient, reliable, and type-safe processing.
 */
export class DSPyFilter {
    private llm: ChatLunaChatModel
    private config: DSPyFilterConfig
    private systemMessage: SystemMessage

    constructor(llm: ChatLunaChatModel, config: DSPyFilterConfig = {}) {
        this.llm = llm
        this.config = {
            maxCompletionTokens: 256, // Reduced token count as we only need indices
            model: 'default',
            ...config
        }
        this.systemMessage = this.makeSystemMessage()
    }

    private makeSystemMessage(): SystemMessage {
        const systemPrompt = `You are an intelligent assistant for a Question-Answering system. Your task is to filter a list of facts based on their relevance to a given query.

You will be provided with:
1.  A 'question'.
2.  A 'candidate_facts' list, where each fact is prefixed with its index.

Your goal is to identify up to 4 facts from the list that are most relevant to answering the question.

You MUST respond with a single, valid JSON object containing a single key "selected_indices", which is an array of the integer indices of the facts you have selected.

Example:
If you select the facts at index 0 and 3, your response must be:
{
  "selected_indices": [0, 3]
}

If no facts are relevant, return an empty array:
{
  "selected_indices": []
}

Only return the JSON object. Do not include any other text, explanations, or markdown formatting.`

        return new SystemMessage(systemPrompt)
    }

    /**
     * Parses the LLM's JSON response to extract selected fact indices.
     * @throws An error if the response is not valid JSON or has an incorrect structure.
     */
    private parseResponse(response: string): number[] {
        const jsonString = response
            .trim()
            .replace(/```json/g, '')
            .replace(/```/g, '')
        const parsed = JSON.parse(jsonString)

        if (
            !parsed ||
            !Array.isArray(parsed.selected_indices) ||
            !parsed.selected_indices.every(Number.isInteger)
        ) {
            throw new Error(
                'Invalid LLM response format. Expected { "selected_indices": [number] }.'
            )
        }

        return parsed.selected_indices
    }

    /**
     * Makes an LLM call to get the indices of relevant facts.
     * @throws An error if the LLM call fails.
     */
    private async llmCall(
        question: string,
        formattedFacts: string
    ): Promise<string> {
        const userPrompt = `Question: "${question}"

Candidate Facts:
${formattedFacts}

Based on the question, please select the most relevant fact indices.`

        const messages: BaseMessage[] = [
            this.systemMessage,
            new HumanMessage(userPrompt)
        ]

        // It's recommended to enable JSON mode if the model provider supports it.
        // For example: `response_format: { type: 'json_object' }`
        const response = await this.llm.invoke(messages, {
            maxTokens: this.config.maxCompletionTokens
        })

        return getMessageContent(response.content)
    }

    /**
     * Reranks facts based on their relevance to the query using a robust, index-based LLM call.
     *
     * @param query The query string.
     * @param candidateItems List of candidate facts (triples).
     * @param candidateIndices The original indices of the candidate facts.
     * @param lenAfterRerank The maximum number of facts to return.
     * @returns A tuple containing the sorted original indices and the sorted fact items.
     * @throws An error if the LLM call or parsing fails, preventing silent failures.
     */
    async rerank(
        query: string,
        candidateItems: Triple[],
        candidateIndices: number[],
        lenAfterRerank?: number
    ): Promise<[number[], Triple[], Record<string, unknown>]> {
        if (!candidateItems || candidateItems.length === 0) {
            return [[], [], {}]
        }

        // Format facts as a numbered list for the LLM
        const formattedFacts = candidateItems
            .map((item, index) => `${index}: ${JSON.stringify(item)}`)
            .join('\n')

        // Call LLM to get the indices of the most relevant facts
        const response = await this.llmCall(query, formattedFacts)
        const selectedLLMIndices = this.parseResponse(response)

        // Filter and map the selected indices back to the original candidate items and indices
        const finalIndices = selectedLLMIndices
            .filter((idx) => idx >= 0 && idx < candidateItems.length) // Ensure indices are valid
            .slice(0, lenAfterRerank) // Apply length limit

        const sortedCandidateIndices = finalIndices.map(
            (i) => candidateIndices[i]
        )
        const sortedCandidateItems = finalIndices.map((i) => candidateItems[i])

        const rerankLog = {
            facts_before_rerank: candidateItems,
            facts_after_rerank: sortedCandidateItems
        }

        return [sortedCandidateIndices, sortedCandidateItems, rerankLog]
    }

    /**
     * Alternative call interface for compatibility.
     */
    async call(
        query: string,
        candidateItems: Triple[],
        candidateIndices: number[],
        lenAfterRerank?: number
    ): Promise<[number[], Triple[], Record<string, unknown>]> {
        return this.rerank(
            query,
            candidateItems,
            candidateIndices,
            lenAfterRerank
        )
    }
}
