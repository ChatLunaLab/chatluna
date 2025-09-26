/**
 * Core data structures for the EMGAS (Episodic Memory Graph with Activation Spreading) model.
 * Based on the TypeScript blueprint provided in the design document.
 */

/**
 * Options for the Spreading Activation retrieval algorithm.
 */
export interface SpreadingActivationOptions {
    /**
     * The minimum activation value a node must have to "fire" and spread its activation to neighbors.
     * A higher value leads to a more focused, less exploratory search.
     * Typical range: 0.0 - 1.0.
     */
    firingThreshold: number

    /**
     * The factor by which activation energy is reduced during propagation to a neighbor.
     * A value closer to 0 limits the spread to immediate neighbors, while a value closer to 1 allows activation to travel farther.
     * Typical range: 0.0 - 1.0.
     */
    propagationDecay: number

    /**
     * The maximum number of iterations for the activation spreading process.
     * This is a hard limit to ensure timely retrieval.
     * Typical range: 3 - 10.
     */
    maxIterations: number

    /**
     * The number of top-activated nodes to retrieve after the spreading process.
     */
    topN: number
}

/**
 * Represents a node in the memory graph. It can be a 'concept' or a 'topic'.
 */
export interface MemoryNode {
    /**
     * The unique identifier for the node, typically the normalized (e.g., lemmatized) text of the concept.
     */
    id: string

    /**
     * The type of the node.
     * 'concept': A specific keyword, entity, or phrase from the text.
     * 'topic': A higher-level abstraction grouping related concepts.
     */
    type: 'concept' | 'topic'

    /**
     * The base activation score of the node, representing its long-term importance.
     * This value decays over time and is boosted when the node is accessed.
     */
    baseActivation: number

    /**
     * The timestamp when the node was first created.
     */
    createdAt: Date

    /**
     * The timestamp when the node was last accessed (mentioned in a query or retrieved).
     */
    lastAccessed: Date

    /**
     * For 'concept' nodes, this set contains the IDs of the original text passages (memories)
     * where the concept appeared. This links the graph back to the source data.
     */
    sourcePassageIds?: Set<string>
}

/**
 * Represents a weighted edge in the memory graph, connecting two nodes.
 */
export interface MemoryEdge {
    /**
     * The ID of the source node.
     */
    sourceId: string

    /**
     * The ID of the target node.
     */
    targetId: string

    /**
     * The weight of the edge, typically representing the associative strength (e.g., PPMI score)
     * between the two connected nodes.
     */
    weight: number

    /**
     * The type of the edge.
     * 'associative': Connects two concepts, representing their co-occurrence.
     * 'hierarchical': Connects a concept to a topic.
     */
    type: 'associative' | 'hierarchical'
}

/**
 * Represents the entire memory graph, including nodes, edges, and persistence data.
 */
export interface SerializedMemoryGraph {
    nodes: MemoryNode[]
    edges: MemoryEdge[]
    conceptCounts: [string, number][]
    pairCounts: [string, number][]
    totalObservations: number
}
