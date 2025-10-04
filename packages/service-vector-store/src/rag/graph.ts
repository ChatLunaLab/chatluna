import * as fs from 'fs/promises'

// --- Interfaces (API remains unchanged) ---

export interface GraphNode {
    id: string
    name: string
    content?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
}

export interface GraphEdge {
    source: string
    target: string
    weight: number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>
}

/**
 * A highly optimized Sparse Matrix implementation using nested Maps.
 * This structure provides O(1) access to rows, which is critical for graph traversal algorithms.
 * Data is stored as Map<rowIndex, Map<colIndex, value>>.
 */
class SparseMatrix {
    // The core data structure: a map of rows, where each row is a map of columns to values.
    private _rows: Map<number, Map<number, number>> = new Map()
    private _size: number
    private _nnz: number = 0 // Tracks the number of non-zero elements for efficiency.

    constructor(size: number) {
        this._size = size
    }

    /**
     * Set value at position (i, j).
     * O(1) on average.
     */
    set(i: number, j: number, value: number): void {
        if (i >= this._size || j >= this._size) {
            throw new Error(
                `Index out of bounds: (${i}, ${j}) for size ${this._size}`
            )
        }

        const row = this._rows.get(i)

        if (value === 0) {
            if (row?.has(j)) {
                row.delete(j)
                this._nnz--
                if (row.size === 0) {
                    this._rows.delete(i)
                }
            }
        } else {
            if (!row) {
                const newRow = new Map<number, number>()
                newRow.set(j, value)
                this._rows.set(i, newRow)
                this._nnz++
            } else {
                if (!row.has(j)) {
                    this._nnz++
                }
                row.set(j, value)
            }
        }
    }

    /**
     * Get value at position (i, j).
     * O(1) on average.
     */
    get(i: number, j: number): number {
        return this._rows.get(i)?.get(j) ?? 0
    }

    /**
     * Get all non-zero entries for row i. This is the most critical optimization.
     * O(1) to get the row map.
     */
    getRow(i: number): Map<number, number> {
        return this._rows.get(i) || new Map()
    }

    /**
     * Get all non-zero entries.
     * Returns an iterator for efficient traversal without creating a large array.
     */
    *entries(): IterableIterator<[number, number, number]> {
        for (const [i, row] of this._rows.entries()) {
            for (const [j, value] of row.entries()) {
                yield [i, j, value]
            }
        }
    }

    /**
     * Get size of the matrix.
     */
    get size(): number {
        return this._size
    }

    /**
     * Get number of non-zero entries.
     * O(1) due to internal tracking.
     */
    get nnz(): number {
        return this._nnz
    }

    /**
     * Resize the matrix.
     */
    resize(newSize: number): void {
        if (newSize < this._size) {
            // Remove rows and columns that are out of the new bounds.
            for (const i of this._rows.keys()) {
                if (i >= newSize) {
                    this._nnz -= this._rows.get(i)!.size
                    this._rows.delete(i)
                } else {
                    const row = this._rows.get(i)!
                    for (const j of row.keys()) {
                        if (j >= newSize) {
                            row.delete(j)
                            this._nnz--
                        }
                    }
                    if (row.size === 0) {
                        this._rows.delete(i)
                    }
                }
            }
        }
        this._size = newSize
    }

    /**
     * Serialize to buffer for binary storage.
     * Optimized to avoid any string operations.
     */
    toBuffer(): Buffer {
        // 4 bytes for size, 4 for nnz, and 16 for each entry (i, j, value).
        const buffer = Buffer.allocUnsafe(8 + this.nnz * 16)
        let offset = 0

        buffer.writeUInt32LE(this._size, offset)
        offset += 4
        buffer.writeUInt32LE(this.nnz, offset)
        offset += 4

        for (const [i, row] of this._rows.entries()) {
            for (const [j, value] of row.entries()) {
                buffer.writeUInt32LE(i, offset)
                offset += 4
                buffer.writeUInt32LE(j, offset)
                offset += 4
                buffer.writeDoubleLE(value, offset)
                offset += 8
            }
        }

        return buffer
    }

    /**
     * Deserialize from buffer.
     * Optimized to avoid any string operations.
     */
    static fromBuffer(buffer: Buffer): SparseMatrix {
        let offset = 0
        const size = buffer.readUInt32LE(offset)
        offset += 4
        const numEntries = buffer.readUInt32LE(offset)
        offset += 4

        const matrix = new SparseMatrix(size)
        for (let e = 0; e < numEntries; e++) {
            const i = buffer.readUInt32LE(offset)
            offset += 4
            const j = buffer.readUInt32LE(offset)
            offset += 4
            const value = buffer.readDoubleLE(offset)
            offset += 8
            matrix.set(i, j, value)
        }
        return matrix
    }
}

/**
 * High-performance graph implementation.
 */
export class ChatLunaGraph {
    private _nodes: Map<string, GraphNode> = new Map()
    private _nodeIdToIndex: Map<string, number> = new Map()
    private _indexToNodeId: string[] = [] // Array is faster for index-to-ID mapping
    private _adjacencyMatrix: SparseMatrix
    private _directed: boolean

    // Pre-calculated out-degrees for PageRank. Invalidated on structural changes.
    private _outDegrees: number[] | null = null

    constructor(directed: boolean = false) {
        this._directed = directed
        this._adjacencyMatrix = new SparseMatrix(0)
    }

    private _invalidateCache(): void {
        this._outDegrees = null
    }

    /**
     * Add a vertex to the graph.
     */
    addVertex(node: GraphNode): number {
        if (this._nodeIdToIndex.has(node.id)) {
            // Update existing node data
            this._nodes.set(node.id, { ...node })
            return this._nodeIdToIndex.get(node.id)!
        }

        this._invalidateCache()
        const index = this._indexToNodeId.length

        this._nodes.set(node.id, { ...node })
        this._nodeIdToIndex.set(node.id, index)
        this._indexToNodeId.push(node.id)

        if (index >= this._adjacencyMatrix.size) {
            this._adjacencyMatrix.resize(this._indexToNodeId.length)
        }

        return index
    }

    /**
     * Add multiple vertices efficiently.
     */
    addVertices(nodes: GraphNode[]): number[] {
        const newNodes = nodes.filter(
            (node) => !this._nodeIdToIndex.has(node.id)
        )
        if (newNodes.length === 0) {
            return nodes.map((node) => this._nodeIdToIndex.get(node.id)!)
        }

        this._invalidateCache()
        const requiredSize = this._indexToNodeId.length + newNodes.length
        this._adjacencyMatrix.resize(requiredSize)

        const indices: number[] = []
        for (const node of nodes) {
            indices.push(this.addVertex(node))
        }

        return indices
    }

    /**
     * Add an edge to the graph.
     */
    addEdge(sourceId: string, targetId: string, weight: number = 1.0): void {
        const sourceIndex = this._nodeIdToIndex.get(sourceId)
        const targetIndex = this._nodeIdToIndex.get(targetId)

        if (sourceIndex === undefined || targetIndex === undefined) {
            throw new Error(
                `Cannot add edge: node not found (${sourceId} -> ${targetId})`
            )
        }

        this._invalidateCache()
        this._adjacencyMatrix.set(sourceIndex, targetIndex, weight)

        if (!this._directed) {
            this._adjacencyMatrix.set(targetIndex, sourceIndex, weight)
        }
    }

    /**
     * Add multiple edges efficiently.
     */
    addEdges(edges: GraphEdge[]): void {
        this._invalidateCache()
        for (const edge of edges) {
            // Inlined addEdge logic for performance, avoiding repeated map lookups
            const sourceIndex = this._nodeIdToIndex.get(edge.source)
            const targetIndex = this._nodeIdToIndex.get(edge.target)
            if (sourceIndex !== undefined && targetIndex !== undefined) {
                this._adjacencyMatrix.set(sourceIndex, targetIndex, edge.weight)
                if (!this._directed) {
                    this._adjacencyMatrix.set(
                        targetIndex,
                        sourceIndex,
                        edge.weight
                    )
                }
            }
        }
    }

    /**
     * Delete vertices and compacts indices to maintain performance.
     * This is a complex operation but ensures the graph remains consistent.
     */
    deleteVertices(nodeIds: string[]): void {
        const indicesToDelete = new Set<number>()
        for (const nodeId of nodeIds) {
            const index = this._nodeIdToIndex.get(nodeId)
            if (index !== undefined) {
                indicesToDelete.add(index)
            }
        }

        if (indicesToDelete.size === 0) return

        this._invalidateCache()

        const oldSize = this.vcount
        const newSize = oldSize - indicesToDelete.size
        const oldIndexToNewIndex = new Array(oldSize)

        const newIndexToNodeId: string[] = []
        const newNodes = new Map<string, GraphNode>()
        const newNodeIdToIndex = new Map<string, number>()

        // Create the new index mapping
        let newIndexCounter = 0
        for (let i = 0; i < oldSize; i++) {
            if (!indicesToDelete.has(i)) {
                oldIndexToNewIndex[i] = newIndexCounter
                const nodeId = this._indexToNodeId[i]
                newIndexToNodeId[newIndexCounter] = nodeId
                newNodeIdToIndex.set(nodeId, newIndexCounter)
                newNodes.set(nodeId, this._nodes.get(nodeId)!)
                newIndexCounter++
            }
        }

        // Rebuild the adjacency matrix with new indices
        const newMatrix = new SparseMatrix(newSize)
        for (const [i, j, weight] of this._adjacencyMatrix.entries()) {
            if (!indicesToDelete.has(i) && !indicesToDelete.has(j)) {
                const newI = oldIndexToNewIndex[i]
                const newJ = oldIndexToNewIndex[j]
                newMatrix.set(newI, newJ, weight)
            }
        }

        // Replace old data structures
        this._nodes = newNodes
        this._nodeIdToIndex = newNodeIdToIndex
        this._indexToNodeId = newIndexToNodeId
        this._adjacencyMatrix = newMatrix
    }

    /**
     * Get node by ID.
     */
    getNode(nodeId: string): GraphNode | undefined {
        return this._nodes.get(nodeId)
    }

    /**
     * Get node by index.
     */
    getNodeByIndex(index: number): GraphNode | undefined {
        const nodeId = this._indexToNodeId[index]
        return nodeId ? this._nodes.get(nodeId) : undefined
    }

    /**
     * Get all nodes.
     */
    get nodes(): GraphNode[] {
        return Array.from(this._nodes.values())
    }

    /**
     * Get node count.
     */
    get vcount(): number {
        return this._indexToNodeId.length
    }

    /**
     * Get edge count.
     */
    get ecount(): number {
        const nnz = this._adjacencyMatrix.nnz
        if (this._directed) return nnz

        // For undirected graphs, count self-loops once.
        let selfLoops = 0
        for (let i = 0; i < this.vcount; i++) {
            if (this._adjacencyMatrix.get(i, i) !== 0) {
                selfLoops++
            }
        }
        return (nnz + selfLoops) / 2
    }

    /**
     * Get neighbors of a node.
     */
    getNeighbors(nodeId: string): { nodeId: string; weight: number }[] {
        const index = this._nodeIdToIndex.get(nodeId)
        if (index === undefined) return []

        const neighbors: { nodeId: string; weight: number }[] = []
        const row = this._adjacencyMatrix.getRow(index)

        for (const [neighborIndex, weight] of row) {
            neighbors.push({
                nodeId: this._indexToNodeId[neighborIndex],
                weight
            })
        }
        return neighbors
    }

    private _calculateOutDegrees(): number[] {
        if (this._outDegrees) {
            return this._outDegrees
        }
        const n = this.vcount
        const outDegrees = new Array(n).fill(0)
        for (let i = 0; i < n; i++) {
            for (const weight of this._adjacencyMatrix.getRow(i).values()) {
                outDegrees[i] += weight
            }
        }
        this._outDegrees = outDegrees
        return outDegrees
    }

    /**
     * Compute standard PageRank.
     */
    pagerank(
        damping: number = 0.85,
        maxIterations: number = 100,
        tolerance: number = 1e-6
    ): number[] {
        const n = this.vcount
        if (n === 0) return []

        let pr = new Array(n).fill(1.0 / n)
        let newPr = new Array(n)
        const outDegrees = this._calculateOutDegrees()
        const danglingSumFactor = (1 - damping) / n

        for (let iter = 0; iter < maxIterations; iter++) {
            newPr.fill(danglingSumFactor)

            for (let i = 0; i < n; i++) {
                if (outDegrees[i] > 0) {
                    const contribution = (damping * pr[i]) / outDegrees[i]
                    for (const [j, weight] of this._adjacencyMatrix.getRow(i)) {
                        newPr[j] += contribution * weight
                    }
                }
            }

            let diff = 0
            for (let i = 0; i < n; i++) {
                diff += Math.abs(newPr[i] - pr[i])
            }

            if (diff < tolerance) {
                return newPr
            }
            ;[pr, newPr] = [newPr, pr]
        }

        return pr
    }

    /**
     * Compute Personalized PageRank with reset probabilities.
     */
    personalizedPagerank(options: {
        vertices?: number[]
        damping?: number
        directed?: boolean
        weights?: string
        reset: number[]
        implementation?: string
        maxIterations?: number
        tolerance?: number
    }): number[] {
        const {
            damping = 0.85,
            reset,
            maxIterations = 100,
            tolerance = 1e-6
        } = options

        const n = this.vcount
        if (n === 0 || reset.length !== n) return []

        const resetSum = reset.reduce(
            (sum, val) => sum + Math.max(0, val || 0),
            0
        )
        const normalizedReset =
            resetSum > 0
                ? reset.map((val) => Math.max(0, val || 0) / resetSum)
                : new Array(n).fill(1.0 / n)

        let pr = [...normalizedReset]
        let newPr = new Array(n)
        const outDegrees = this._calculateOutDegrees()

        for (let iter = 0; iter < maxIterations; iter++) {
            for (let i = 0; i < n; i++) {
                newPr[i] = (1 - damping) * normalizedReset[i]
            }

            for (let i = 0; i < n; i++) {
                if (outDegrees[i] > 0) {
                    const contribution = (damping * pr[i]) / outDegrees[i]
                    for (const [j, weight] of this._adjacencyMatrix.getRow(i)) {
                        newPr[j] += contribution * weight
                    }
                }
            }

            let diff = 0
            for (let i = 0; i < n; i++) {
                diff += Math.abs(newPr[i] - pr[i])
            }

            if (diff < tolerance) {
                return newPr
            }
            ;[pr, newPr] = [newPr, pr]
        }
        return pr
    }

    /**
     * Binary serialization for efficient storage.
     */
    async serialize(filePath: string): Promise<void> {
        // Using a more compact format for metadata
        const data = {
            d: this._directed, // directed
            n: this._nodes, // nodes
            i2n: this._indexToNodeId, // indexToNodeId
            n2i: this._nodeIdToIndex // nodeIdToIndex
        }

        const metadataStr = JSON.stringify(data, (key, value) => {
            if (value instanceof Map) {
                return { dataType: 'Map', value: Array.from(value.entries()) }
            }
            return value
        })

        const metadataBuffer = Buffer.from(metadataStr, 'utf8')
        const metadataLengthBuffer = Buffer.allocUnsafe(4)
        metadataLengthBuffer.writeUInt32LE(metadataBuffer.length, 0)

        const matrixBuffer = this._adjacencyMatrix.toBuffer()
        const totalBuffer = Buffer.concat([
            metadataLengthBuffer,
            metadataBuffer,
            matrixBuffer
        ])
        await fs.writeFile(filePath, totalBuffer)
    }

    /**
     * Binary deserialization for efficient loading.
     */
    static async deserialize(filePath: string): Promise<ChatLunaGraph> {
        const buffer = await fs.readFile(filePath)
        let offset = 0

        const metadataLength = buffer.readUInt32LE(offset)
        offset += 4

        const metadataBuffer = buffer.subarray(offset, offset + metadataLength)
        offset += metadataLength

        const data = JSON.parse(
            metadataBuffer.toString('utf8'),
            (key, value) => {
                if (
                    typeof value === 'object' &&
                    value !== null &&
                    value.dataType === 'Map'
                ) {
                    return new Map(value.value)
                }
                return value
            }
        )

        const graph = new ChatLunaGraph(data.d)
        graph._nodes = data.n
        graph._indexToNodeId = data.i2n
        graph._nodeIdToIndex = data.n2i

        const matrixBuffer = buffer.subarray(offset)
        graph._adjacencyMatrix = SparseMatrix.fromBuffer(matrixBuffer)

        return graph
    }

    /**
     * Check if file exists for loading.
     */
    static async exists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath)
            return true
        } catch {
            return false
        }
    }

    // --- Unchanged Public API Methods ---

    /**
     * Get graph statistics.
     */
    getStats(): {
        nodeCount: number
        edgeCount: number
        density: number
        memoryUsage: string
    } {
        const nodeCount = this.vcount
        const edgeCount = this.ecount
        const density =
            nodeCount > 1 ? (2 * edgeCount) / (nodeCount * (nodeCount - 1)) : 0

        // A more realistic memory estimation
        const nodeMemory = this._nodes.size * 150 // Estimate per node object
        const mapOverhead = 24 // Base overhead for a map entry
        const matrixMemory =
            this._adjacencyMatrix.nnz * (mapOverhead + 4 + 4 + 8) // entry + int + int + float
        const totalBytes = nodeMemory + matrixMemory

        return {
            nodeCount,
            edgeCount,
            density,
            memoryUsage: `${(totalBytes / 1024 / 1024).toFixed(3)} MB`
        }
    }

    /**
     * Get node index by ID.
     */
    getNodeIndex(nodeId: string): number | undefined {
        return this._nodeIdToIndex.get(nodeId)
    }

    /**
     * Get all node IDs.
     */
    getNodeIds(): string[] {
        return Array.from(this._nodes.keys())
    }

    /**
     * Check if node exists.
     */
    hasNode(nodeId: string): boolean {
        return this._nodes.has(nodeId)
    }

    /**
     * Get edge weight between two nodes.
     */
    getEdgeWeight(sourceId: string, targetId: string): number {
        const sourceIndex = this._nodeIdToIndex.get(sourceId)
        const targetIndex = this._nodeIdToIndex.get(targetId)

        if (sourceIndex === undefined || targetIndex === undefined) {
            return 0
        }

        return this._adjacencyMatrix.get(sourceIndex, targetIndex)
    }
}
