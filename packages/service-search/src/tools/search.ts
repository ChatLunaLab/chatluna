/* eslint-disable max-len */
import { Tool } from '@langchain/core/tools'
import { SearchManager } from '../provide'
import { BrowserManager } from './browser/manager'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { MemoryVectorStore } from 'koishi-plugin-chatluna/llm-core/vectorstores'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { SearchResult, SummaryType } from '../types'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { PromptTemplate } from '@langchain/core/prompts'
import { getMessageContent } from 'koishi-plugin-chatluna/utils/string'
/* import fs from 'fs/promises' */
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { logger } from '..'
import { removeProperty } from '../utils/parse'
import { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ComputedRef } from 'koishi-plugin-chatluna'

export const SEARCH_TOOL_DESCRIPTION =
    'An search engine. Useful for when you need to answer questions about current events. Input should be a raw string of keyword. About Search Keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, "What is the weather in Beijing today?" would be "Beijing weather today"'

export class SearchTool extends Tool {
    name = 'web_search'

    description = SEARCH_TOOL_DESCRIPTION

    private _textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 600,
        chunkOverlap: 100
    })

    private llm: ComputedRef<ChatLunaChatModel>

    constructor(
        private searchManager: SearchManager,
        private browser: BrowserManager | undefined,
        private embeddings: Embeddings,
        llm: ComputedRef<ChatLunaChatModel>,
        private summaryType: SummaryType
    ) {
        super({})

        this.llm = llm
    }

    async _call(
        query: string,
        _,
        config: ChatLunaToolRunnable
    ): Promise<string> {
        const llm = this.llm?.value ?? config.configurable.model

        const docs = await this.fetchSearchResult(query, llm, config)

        if (this.summaryType !== SummaryType.Balanced) {
            return JSON.stringify(
                docs.map((doc) => Object.assign({}, doc.metadata))
            )
        }

        const result = await generateFakeSearchResult(query, llm)

        return JSON.stringify(
            await this._reRankDocuments(getMessageContent(result.content), docs)
        )
    }

    private async fetchSearchResult(
        query: string,
        llm: ChatLunaChatModel,
        runConfig: ChatLunaToolRunnable
    ) {
        const results = await this.searchManager.search(query)

        if (this.summaryType === SummaryType.Speed) {
            return results.map((result) => ({
                pageContent: result.description,
                metadata: result
            })) as Document[]
        }

        const docs: Document[] = []
        for (const result of results) {
            try {
                docs.push(
                    ...(await this.createDocuments(
                        result,
                        query,
                        llm,
                        runConfig
                    ))
                )
            } catch (err) {
                logger.error(err)
            }
        }

        return docs
    }

    private async createDocuments(
        result: SearchResult,
        query: string,
        llm: ChatLunaChatModel,
        runConfig: ChatLunaToolRunnable
    ) {
        const content = await this.readResult(result, query, llm, runConfig)

        if (content == null) return []

        const chunks = await this._textSplitter.splitText(content)

        return chunks.map((chunk) => {
            const metadata =
                this.summaryType === SummaryType.Quality
                    ? Object.assign(
                          { description: chunk },
                          removeProperty(result, ['description'])
                      )
                    : Object.assign({}, result, { description: chunk })

            return {
                pageContent: chunk,
                metadata
            } as Document
        })
    }

    private async readResult(
        result: SearchResult,
        query: string,
        llm: ChatLunaChatModel,
        runConfig: ChatLunaToolRunnable
    ) {
        if (result.url.length < 1) return result.description

        if (result.description && result.description.length >= 500) {
            return result.description
        }

        if (!this.browser) return result.description

        const text = await (async () => {
            try {
                return this.summaryType === SummaryType.Quality
                    ? await this.browser.summarize(
                          { url: result.url, focus: query },
                          llm,
                          runConfig
                      )
                    : await this.browser.readText(
                          { url: result.url },
                          runConfig
                      )
            } catch {
                return result.description
            }
        })()

        if (isBrowserError(text)) return result.description

        return text
    }

    private async _reRankDocuments(query: string, documents: Document[]) {
        if (documents.length < 1) return []

        if (this.embeddings === emptyEmbeddings) {
            logger.warn('Embeddings is empty, try check your config')
            return documents
                .map((document) => document.metadata as SearchResult)
                .slice(0, this.searchManager.config.topK * 2)
        }

        const vectorStore = new MemoryVectorStore(this.embeddings)

        await vectorStore.addDocuments(documents)

        const searchResult = await vectorStore.similaritySearchWithScore(
            query,
            this.searchManager.config.topK * 2
        )

        /*   for (const [index, result] of searchResult.entries()) {
            await fs.writeFile(`tmp/tmp-${index}.txt`, result[0].pageContent)
        } */

        return searchResult
            .filter(
                (result) =>
                    result[1] > this.searchManager.config.searchThreshold
            )
            .map((result) => result[0].metadata as SearchResult)
            .slice(0, this.searchManager.config.topK)
    }
}

export async function generateFakeSearchResult(
    query: string,
    llm: ChatLunaChatModel
) {
    return llm.invoke(
        await GENERATE_FAKE_SEARCH_RESULT_PROMPT.format({ query }),
        {
            temperature: 0
        }
    )
}

const GENERATE_FAKE_SEARCH_RESULT_PROMPT = new PromptTemplate({
    template: `Based on the question: "{query}"

Generate a brief, factual answer that:
- Directly addresses the core question
- Uses clear and concise language
- Stays between 50-100 characters
- Contains key factual information
- Avoids speculation or uncertainty

Answer the question as if you are a search result snippet.`,
    inputVariables: ['query']
})

function isBrowserError(text: string) {
    return (
        text.includes('Error getting page text:') ||
        text.includes('Error summarizing page:') ||
        text === '[none]'
    )
}
