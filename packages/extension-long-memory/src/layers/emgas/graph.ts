import { ExtractedGraphElements } from './extractor'
import {
    MemoryEdge,
    MemoryNode,
    SerializedMemoryGraph,
    SpreadingActivationOptions
} from './types'

/**
 * A class that implements the EMGAS (Episodic Memory Graph with Activation Spreading) framework.
 * It manages a dynamic graph of concepts, handles incremental updates, and performs retrieval
 * using a spreading activation algorithm.
 */
export class MemoryGraph {
    // Graph structure
    private nodes: Map<string, MemoryNode> = new Map()
    // Adjacency list representation for edges: sourceId -> targetId -> edge
    private edges: Map<string, Map<string, MemoryEdge>> = new Map()

    // Global counters for incremental PMI calculation
    private conceptCounts: Map<string, number> = new Map()
    private pairCounts: Map<string, number> = new Map() // Key is "concept1|concept2" with sorted keys
    private totalObservations: number = 0

    constructor() {
        // The constructor can be used to initialize from a persisted state.
    }

    /**
     * Incrementally updates the graph with concepts and topics extracted from a text chunk.
     * @param elements The concepts and topics extracted by the LLM.
     * @param passageId A unique identifier for the original text chunk.
     */
    public incrementalUpdate(
        elements: ExtractedGraphElements,
        passageId: string
    ): void {
        const { concepts, topics } = elements
        if (!concepts || concepts.length === 0) {
            return
        }

        const now = new Date()

        // Step 1: Update concept nodes
        for (const concept of concepts) {
            if (!this.nodes.has(concept)) {
                this.nodes.set(concept, {
                    id: concept,
                    type: 'concept',
                    baseActivation: 1.0,
                    createdAt: now,
                    lastAccessed: now,
                    sourcePassageIds: new Set([passageId])
                })
            } else {
                const node = this.nodes.get(concept)!
                node.lastAccessed = now
                node.sourcePassageIds!.add(passageId)
                this.boostNodeActivation(concept)
            }
        }

        // Step 2: Update topic nodes
        for (const topic of topics) {
            if (!this.nodes.has(topic)) {
                this.nodes.set(topic, {
                    id: topic,
                    type: 'topic',
                    baseActivation: 1.0,
                    createdAt: now,
                    lastAccessed: now
                })
            } else {
                const node = this.nodes.get(topic)!
                node.lastAccessed = now
                this.boostNodeActivation(topic)
            }
        }

        // Step 3: Update co-occurrence counts for concepts
        this.totalObservations += 1
        const uniqueConcepts = Array.from(new Set(concepts))

        for (const concept of uniqueConcepts) {
            this.conceptCounts.set(
                concept,
                (this.conceptCounts.get(concept) || 0) + 1
            )
        }

        for (let i = 0; i < uniqueConcepts.length; i++) {
            for (let j = i + 1; j < uniqueConcepts.length; j++) {
                const key = this.getPairKey(
                    uniqueConcepts[i],
                    uniqueConcepts[j]
                )
                this.pairCounts.set(key, (this.pairCounts.get(key) || 0) + 1)
            }
        }

        // Step 4: Create/update edges
        // 4a: Associative edges between concepts
        for (let i = 0; i < uniqueConcepts.length; i++) {
            for (let j = i + 1; j < uniqueConcepts.length; j++) {
                const concept1 = uniqueConcepts[i]
                const concept2 = uniqueConcepts[j]
                const weight = this.calculatePPMI(concept1, concept2)
                this.addEdge(concept1, concept2, weight, 'associative')
            }
        }

        // 4b: Hierarchical edges from concepts to topics
        for (const concept of uniqueConcepts) {
            for (const topic of topics) {
                this.addEdge(concept, topic, 1.0, 'hierarchical') // Unweighted, directed
            }
        }
    }

    private getPairKey(concept1: string, concept2: string): string {
        return [concept1, concept2].sort().join('|')
    }

    private addEdge(
        sourceId: string,
        targetId: string,
        weight: number,
        type: 'associative' | 'hierarchical'
    ): void {
        if (sourceId === targetId) return

        if (!this.edges.has(sourceId)) {
            this.edges.set(sourceId, new Map())
        }
        this.edges
            .get(sourceId)!
            .set(targetId, { sourceId, targetId, weight, type })

        // Associative edges are undirected, so add a backward edge
        if (type === 'associative') {
            if (!this.edges.has(targetId)) {
                this.edges.set(targetId, new Map())
            }
            this.edges.get(targetId)!.set(sourceId, {
                sourceId: targetId,
                targetId: sourceId,
                weight,
                type
            })
        }
    }

    private calculatePPMI(concept1: string, concept2: string): number {
        if (this.totalObservations === 0) return 0

        const pairKey = this.getPairKey(concept1, concept2)
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const p_xy =
            (this.pairCounts.get(pairKey) || 0) / this.totalObservations
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const p_x =
            (this.conceptCounts.get(concept1) || 0) / this.totalObservations
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const p_y =
            (this.conceptCounts.get(concept2) || 0) / this.totalObservations

        if (p_xy === 0 || p_x === 0 || p_y === 0) {
            return 0
        }

        const pmi = Math.log2(p_xy / (p_x * p_y))
        return Math.max(0, pmi)
    }

    private boostNodeActivation(nodeId: string): void {
        if (this.nodes.has(nodeId)) {
            const node = this.nodes.get(nodeId)!
            node.baseActivation = Math.min(5.0, node.baseActivation + 0.5)
        }
    }

    public retrieveContext(
        seedConcepts: string[],
        options: SpreadingActivationOptions
    ): Set<string> {
        // Step 1: Initialize activations
        let activations = new Map<string, number>()

        for (const nodeId of this.nodes.keys()) {
            activations.set(nodeId, 0.0)
        }

        for (const seed of seedConcepts) {
            if (this.nodes.has(seed)) {
                activations.set(seed, 1.0)
            }
        }

        // Step 2: Iterative Spreading
        for (let i = 0; i < options.maxIterations; i++) {
            const firedNodes: string[] = []
            for (const [nodeId, activation] of activations.entries()) {
                if (activation > options.firingThreshold) {
                    firedNodes.push(nodeId)
                }
            }

            if (firedNodes.length === 0) {
                break // Stop if no more nodes are active enough to fire
            }

            const newActivations = new Map(activations)

            for (const firingNodeId of firedNodes) {
                const neighbors = this.edges.get(firingNodeId)
                if (!neighbors) continue

                const currentActivation = activations.get(firingNodeId)!

                for (const [neighborId, edge] of neighbors.entries()) {
                    const energy =
                        currentActivation *
                        edge.weight *
                        options.propagationDecay
                    newActivations.set(
                        neighborId,
                        (newActivations.get(neighborId) || 0) + energy
                    )
                }

                // Optional: Decay the firing node's own energy to prevent infinite loops
                newActivations.set(
                    firingNodeId,
                    currentActivation * (1 - options.propagationDecay)
                )
            }

            activations = newActivations
        }

        // Step 3: Collect results
        const sortedNodes = [...activations.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, options.topN)

        const passageIds = new Set<string>()
        for (const [nodeId] of sortedNodes) {
            const node = this.nodes.get(nodeId)
            if (node && node.type === 'concept' && node.sourcePassageIds) {
                for (const passageId of node.sourcePassageIds) {
                    passageIds.add(passageId)
                }
            }
        }

        return passageIds
    }

    public applyDecay(lambda: number): void {
        const now = Date.now()
        for (const node of this.nodes.values()) {
            const lastAccessed = node.lastAccessed.getTime()
            const deltaTHours = (now - lastAccessed) / (1000 * 60 * 60) // Time difference in hours
            const decayFactor = Math.exp(-lambda * deltaTHours)
            node.baseActivation *= decayFactor
        }
    }

    public pruneGraph(threshold: number): void {
        const nodesToPrune: string[] = []
        for (const node of this.nodes.values()) {
            if (node.baseActivation < threshold) {
                nodesToPrune.push(node.id)
            }
        }

        for (const nodeId of nodesToPrune) {
            this.nodes.delete(nodeId)
            this.edges.delete(nodeId)
            for (const otherNodeEdges of this.edges.values()) {
                otherNodeEdges.delete(nodeId)
            }
        }
    }

    public getNodes(): IterableIterator<MemoryNode> {
        return this.nodes.values()
    }

    public toJSON(): SerializedMemoryGraph {
        const nodes: MemoryNode[] = Array.from(this.nodes.values()).map(
            (node) =>
                ({
                    ...node,
                    sourcePassageIds: node.sourcePassageIds
                        ? Array.from(node.sourcePassageIds)
                        : []
                }) as unknown as MemoryNode
        )

        const edges: MemoryEdge[] = []
        const seenEdges = new Set<string>()
        for (const source of this.edges.values()) {
            for (const edge of source.values()) {
                const key = [edge.sourceId, edge.targetId].sort().join('|')
                if (!seenEdges.has(key)) {
                    edges.push(edge)
                    seenEdges.add(key)
                }
            }
        }

        return {
            nodes,
            edges,
            conceptCounts: Array.from(this.conceptCounts.entries()),
            pairCounts: Array.from(this.pairCounts.entries()),
            totalObservations: this.totalObservations
        }
    }

    public static fromJSON(
        serializedGraph: SerializedMemoryGraph
    ): MemoryGraph {
        const graph = new MemoryGraph()

        if (!serializedGraph) return graph

        for (const nodeData of serializedGraph.nodes || []) {
            graph.nodes.set(nodeData.id, {
                ...nodeData,
                createdAt: new Date(nodeData.createdAt),
                lastAccessed: new Date(nodeData.lastAccessed),
                sourcePassageIds: new Set(nodeData.sourcePassageIds || [])
            })
        }

        for (const edge of serializedGraph.edges || []) {
            graph.addEdge(edge.sourceId, edge.targetId, edge.weight, edge.type)
        }

        graph.conceptCounts = new Map(serializedGraph.conceptCounts || [])
        graph.pairCounts = new Map(serializedGraph.pairCounts || [])
        graph.totalObservations = serializedGraph.totalObservations || 0

        return graph
    }
}
