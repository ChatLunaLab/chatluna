import * as fs from 'fs/promises'
import * as path from 'path'
import { computeMDHashId } from '../utils'
import {
    ChunkInfo,
    NerRawOutput,
    OpenIEDocument,
    OpenIEResult,
    OpenIEResults,
    TripleRawOutput
} from '../utils/types'
import { InformationExtractionProcessor } from './ie_processor'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'

/**
 * OpenIE data management
 * Simplified storage and retrieval of OpenIE extraction results
 */
export class OpenIE {
    private _resultsPath: string
    private _data: OpenIEDocument[] = []
    private _processor: InformationExtractionProcessor

    constructor(saveDir: string, llm: ChatLunaChatModel) {
        const llmLabel = llm.name.replace(/\//g, '_')
        this._resultsPath = path.join(
            saveDir,
            `openie_results_ner_${llmLabel}.json`
        )
        this._processor = new InformationExtractionProcessor(llm)
    }

    /**
     * Load OpenIE data from file
     */
    async load(): Promise<OpenIEDocument[]> {
        try {
            const fileContent = await fs.readFile(this._resultsPath, 'utf-8')
            const openieResults: OpenIEResults = JSON.parse(fileContent)
            this._data = openieResults.docs || []
            return this._data
        } catch (error) {
            this._data = []
            return this._data
        }
    }

    /**
     * Save OpenIE data to file
     */
    async save(): Promise<void> {
        const openieDict: OpenIEResults = {
            docs: this._data
        }

        await fs.writeFile(
            this._resultsPath,
            JSON.stringify(openieDict, null, 2),
            'utf-8'
        )
    }

    /**
     * Get all OpenIE documents
     */
    getAll(): OpenIEDocument[] {
        return this._data
    }

    /**
     * Get OpenIE document by ID
     */
    getById(id: string): OpenIEDocument | undefined {
        return this._data.find((doc) => doc.idx === id)
    }

    /**
     * Add new OpenIE document
     */
    add(document: OpenIEDocument): void {
        const existingIndex = this._data.findIndex(
            (doc) => doc.idx === document.idx
        )
        if (!document.idx) {
            document.idx = computeMDHashId(document.passage)
        }
        if (existingIndex >= 0) {
            this._data[existingIndex] = document
        } else {
            this._data.push(document)
        }
    }

    /**
     * Named Entity Recognition (NER) extraction
     */
    async ner(chunkKey: string, passage: string): Promise<NerRawOutput> {
        return this._processor.ner(chunkKey, passage)
    }

    /**
     * Triple extraction
     */
    async tripleExtraction(
        chunkKey: string,
        passage: string,
        namedEntities: string[]
    ): Promise<TripleRawOutput> {
        return this._processor.tripleExtraction(
            chunkKey,
            passage,
            namedEntities
        )
    }

    /**
     * Combined OpenIE extraction (NER + Triple extraction)
     */
    async openIE(chunkKey: string, passage: string): Promise<OpenIEResult> {
        return this._processor.openIE(chunkKey, passage)
    }

    /**
     * Batch OpenIE extraction for multiple chunks
     */
    async batchOpenIE(
        chunks: Record<string, ChunkInfo>
    ): Promise<
        [Record<string, NerRawOutput>, Record<string, TripleRawOutput>]
    > {
        return this._processor.batchOpenIE(chunks)
    }

    /**
     * Process and store OpenIE extraction for a single passage
     */
    async processAndStore(
        chunkKey: string,
        passage: string
    ): Promise<OpenIEDocument> {
        const result = await this.openIE(chunkKey, passage)
        const document = OpenIE.createDocument(
            chunkKey,
            passage,
            result.ner.uniqueEntities,
            result.triplets.triples
        )
        this.add(document)
        return document
    }

    /**
     * Merges OpenIE extraction results with corresponding passage and metadata
     * Based on the Python merge_openie_results method from HippoRAG
     */
    mergeDocuments(
        chunksToSave: Record<string, { content: string }>,
        nerResultsDict: Record<string, NerRawOutput>,
        tripleResultsDict: Record<string, TripleRawOutput>
    ): void {
        for (const [chunkKey, row] of Object.entries(chunksToSave)) {
            const passage = row.content
            try {
                const document: OpenIEDocument = {
                    idx: chunkKey,
                    passage,
                    extractedEntities:
                        nerResultsDict[chunkKey]?.uniqueEntities || [],
                    extractedTriples: tripleResultsDict[chunkKey]?.triples || []
                }
                this.add(document)
            } catch (error) {
                console.error(`Error processing chunk ${chunkKey}:`, error)
                const document: OpenIEDocument = {
                    idx: chunkKey,
                    passage,
                    extractedEntities: [],
                    extractedTriples: []
                }
                this.add(document)
            }
        }
    }

    /**
     * Create OpenIE document from components
     */
    static createDocument(
        id: string,
        passage: string,
        entities: string[],
        triples: [string, string, string][]
    ): OpenIEDocument {
        return {
            idx: id,
            passage,
            extractedEntities: entities,
            extractedTriples: triples
        }
    }

    /**
     * Set OpenIE documents (replaces current data)
     */
    setDocuments(documents: OpenIEDocument[]): void {
        this._data = documents
    }

    /**
     * Get the path where OpenIE results are stored
     */
    get resultsPath(): string {
        return this._resultsPath
    }

    /**
     * Check if OpenIE results file exists
     */
    async exists(): Promise<boolean> {
        try {
            await fs.access(this._resultsPath)
            return true
        } catch {
            return false
        }
    }
}
