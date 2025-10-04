import {
    charShingleSet,
    computeSimHashHex,
    jaccardFromSets
} from '../../utils/similarity'

export interface SerializedKGIndex {
    adj: [string, string, number][]
    postings: Record<string, string[]>
    simhashEntities: Record<string, string[]>
}

// - Nodes: entities extracted from text
// - Edges: entity co-occurrence within the same memory (undirected, weighted)
// - Posting list: entity -> set of simhash keys for memories containing the entity

export type Entity = string

function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/g, '')
}

export class HippoGraphIndex {
    private adj: Map<Entity, Map<Entity, number>> = new Map()
    private postings: Map<Entity, Set<string>> = new Map()
    // optional reverse: simhash -> entities for convenience
    private simhashEntities: Map<string, Entity[]> = new Map()

    public extractEntities(text: string): Entity[] {
        const norm = normalizeText(text)
        const tokens = norm.split(/\s+/).filter(Boolean)

        const entities: Set<string> = new Set()
        // Simple heuristic:
        // - Chinese: take continuous CJK chars of length >= 2
        // - Latin: tokens length >= 3 (filter digits-only)
        // - Keep topk by length later if needed

        // Extract CJK sequences
        const cjkMatches = norm.match(/[\u4e00-\u9fff]{2,}/g)
        if (cjkMatches) {
            for (const m of cjkMatches) entities.add(m)
        }

        for (const t of tokens) {
            if (/^\d+$/.test(t)) continue
            if (t.length >= 3) entities.add(t)
        }

        return Array.from(entities).slice(0, 50)
    }

    public addMemory(content: string, simhashHex?: string): void {
        const ents = this.extractEntities(content)
        if (ents.length === 0) return

        const key = simhashHex ?? computeSimHashHex(content)

        for (const e of ents) {
            if (!this.postings.has(e)) this.postings.set(e, new Set())
            this.postings.get(e)!.add(key)
        }

        this.simhashEntities.set(key, ents)

        // co-occurrence edges (undirected)
        for (let i = 0; i < ents.length; i++) {
            for (let j = i + 1; j < ents.length; j++) {
                this.addEdge(ents[i], ents[j], 1)
            }
        }
    }

    public removeMemoryBySimhash(simhashHex: string): void {
        // entities involved in this memory
        const ents = this.simhashEntities.get(simhashHex) || []
        // decrement co-occurrence edges contributed by this memory
        if (ents.length > 1) {
            for (let i = 0; i < ents.length; i++) {
                for (let j = i + 1; j < ents.length; j++) {
                    this.decEdge(ents[i], ents[j], 1)
                }
            }
        }
        // remove from postings
        for (const [e, set] of this.postings) {
            if (set.delete(simhashHex) && set.size === 0) {
                this.postings.delete(e)
            }
        }
        this.simhashEntities.delete(simhashHex)
    }

    private addEdge(a: Entity, b: Entity, w: number): void {
        if (a === b) return
        if (!this.adj.has(a)) this.adj.set(a, new Map())
        if (!this.adj.has(b)) this.adj.set(b, new Map())
        this.adj.get(a)!.set(b, (this.adj.get(a)!.get(b) || 0) + w)
        this.adj.get(b)!.set(a, (this.adj.get(b)!.get(a) || 0) + w)
    }

    private decEdge(a: Entity, b: Entity, w = 1): void {
        if (a === b) return
        const ra = this.adj.get(a)
        const rb = this.adj.get(b)
        if (!ra || !rb) return
        const wab = (ra.get(b) || 0) - w
        const wba = (rb.get(a) || 0) - w
        if (wab > 0) ra.set(b, wab)
        else ra.delete(b)
        if (wba > 0) rb.set(a, wba)
        else rb.delete(a)
        if (ra.size === 0) this.adj.delete(a)
        if (rb.size === 0) this.adj.delete(b)
    }

    public addRelationEdge(a: Entity, b: Entity, w = 1): void {
        this.addEdge(a, b, w)
    }

    public seedsFromQuery(query: string): Entity[] {
        return this.extractEntities(query)
    }

    // Personalized PageRank on the entity graph
    public ppr(seeds: Entity[], alpha = 0.15, iters = 20): Map<Entity, number> {
        const nodes = new Set<Entity>()
        for (const [u, nbrs] of this.adj) {
            nodes.add(u)
            for (const v of nbrs.keys()) nodes.add(v)
        }
        for (const s of seeds) nodes.add(s)

        const nodeArr = Array.from(nodes)
        const deg: Map<Entity, number> = new Map()
        for (const u of nodeArr) {
            deg.set(u, this.adj.get(u)?.size || 0)
        }

        const tele: Map<Entity, number> = new Map()
        if (seeds.length > 0) {
            const c = 1 / seeds.length
            for (const s of seeds) tele.set(s, c)
        }

        const r: Map<Entity, number> = new Map()
        const rNew: Map<Entity, number> = new Map()
        for (const u of nodeArr) r.set(u, 1 / Math.max(1, nodeArr.length))

        for (let t = 0; t < iters; t++) {
            for (const u of nodeArr) rNew.set(u, 0)
            for (const u of nodeArr) {
                const nbrs = this.adj.get(u)
                const du = Math.max(1, deg.get(u) || 0)
                const share = ((1 - alpha) * (r.get(u) || 0)) / du
                if (nbrs && nbrs.size > 0) {
                    for (const v of nbrs.keys()) {
                        rNew.set(v, (rNew.get(v) || 0) + share)
                    }
                } else {
                    for (const v of nodeArr) {
                        rNew.set(v, (rNew.get(v) || 0) + share / nodeArr.length)
                    }
                }
            }
            // teleport
            for (const u of nodeArr) {
                const add = alpha * (tele.get(u) || 0)
                rNew.set(u, (rNew.get(u) || 0) + add)
            }
            // swap
            for (const u of nodeArr) r.set(u, rNew.get(u) || 0)
        }

        let sum = 0
        for (const u of nodeArr) sum += r.get(u) || 0
        if (sum > 0) for (const u of nodeArr) r.set(u, (r.get(u) || 0) / sum)

        return r
    }

    // Score a memory by entities overlap with PPR scores
    public scoreContentByPPR(
        content: string,
        entityScores: Map<Entity, number>
    ): number {
        const ents = this.extractEntities(content)
        if (ents.length === 0) return 0
        let s = 0
        for (const e of ents) s += entityScores.get(e) || 0
        return Math.min(1, s / Math.max(1, ents.length))
    }

    public getCandidatesByPPR(
        pprScores: Map<Entity, number>,
        topEntities = 10,
        maxCandidates = 200
    ): Set<string> {
        const sorted = Array.from(pprScores.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.max(1, topEntities))
        const out = new Set<string>()
        for (const [e] of sorted) {
            const set = this.postings.get(e)
            if (!set) continue
            for (const key of set) {
                out.add(key)
                if (out.size >= maxCandidates) return out
            }
        }
        return out
    }

    public getEntitiesForSimhash(simhashHex: string): Entity[] | undefined {
        return this.simhashEntities.get(simhashHex)
    }

    // Bridge similar entities across the graph using character-shingle Jaccard
    public addBridgesForEntities(entities: Entity[], threshold = 0.6): void {
        if (entities.length === 0) return
        const existing = new Set<Entity>([...this.adj.keys()])
        const shA: Map<Entity, Set<string>> = new Map()
        const getSh = (e: Entity) => {
            if (!shA.has(e)) shA.set(e, charShingleSet(e, 3))
            return shA.get(e)!
        }
        for (const e of entities) {
            const shE = getSh(e)
            for (const u of existing) {
                if (u === e) continue
                const shU = getSh(u)
                const s = jaccardFromSets(shE, shU)
                if (s >= threshold)
                    this.addEdge(e, u, Math.max(1, Math.floor(s * 10)))
            }
        }
    }

    // Merge alias entities by similarity threshold; consolidate graph/postings
    public consolidateAliases(threshold = 0.85): void {
        const entities = new Set<string>()
        for (const [u, nbrs] of this.adj) {
            entities.add(u)
            for (const v of nbrs.keys()) entities.add(v)
        }
        if (entities.size === 0) return
        const arr = Array.from(entities)
        const sh: Map<string, Set<string>> = new Map()
        const getSh = (e: string) => {
            if (!sh.has(e)) sh.set(e, charShingleSet(e, 3))
            return sh.get(e)!
        }
        // DSU
        const parent: number[] = arr.map((_, i) => i)
        const find = (x: number): number =>
            parent[x] === x ? x : (parent[x] = find(parent[x]))
        const unite = (a: number, b: number) => {
            const pa = find(a),
                pb = find(b)
            if (pa !== pb) parent[pa] = pb
        }
        for (let i = 0; i < arr.length; i++) {
            const si = getSh(arr[i])
            for (let j = i + 1; j < arr.length; j++) {
                const sj = getSh(arr[j])
                const s = jaccardFromSets(si, sj)
                if (s >= threshold) unite(i, j)
            }
        }
        const rep: Map<string, string> = new Map()
        for (let i = 0; i < arr.length; i++) {
            const r = find(i)
            const key = arr[r]
            rep.set(arr[i], key)
        }
        const newAdj: Map<string, Map<string, number>> = new Map()
        for (const [u, nbrs] of this.adj) {
            const ru = rep.get(u) || u
            if (!newAdj.has(ru)) newAdj.set(ru, new Map())
            for (const [v, w] of nbrs) {
                const rv = rep.get(v) || v
                if (ru === rv) continue
                const row = newAdj.get(ru)!
                row.set(rv, (row.get(rv) || 0) + w)
                if (!newAdj.has(rv)) newAdj.set(rv, new Map())
                const back = newAdj.get(rv)!
                back.set(ru, (back.get(ru) || 0) + w)
            }
        }
        this.adj = newAdj
        const newPost: Map<string, Set<string>> = new Map()
        for (const [e, set] of this.postings) {
            const r = rep.get(e) || e
            if (!newPost.has(r)) newPost.set(r, new Set())
            const dst = newPost.get(r)!
            for (const key of set) dst.add(key)
        }
        this.postings = newPost
        const newSim: Map<string, string[]> = new Map()
        for (const [key, ents] of this.simhashEntities) {
            const mapped = Array.from(new Set(ents.map((e) => rep.get(e) || e)))
            newSim.set(key, mapped)
        }
        this.simhashEntities = newSim
    }

    // Public accessors for stats and neighbors
    public getStats(): { entities: number; edges: number } {
        let edges = 0
        for (const [, nbrs] of this.adj) edges += nbrs.size
        return { entities: this.adj.size, edges: Math.floor(edges / 2) }
    }

    public getNeighborMap(entity: Entity): Map<Entity, number> | undefined {
        return this.adj.get(entity)
    }

    // Persistence
    public toJSON(): SerializedKGIndex {
        const adjList: [string, string, number][] = []
        const seen = new Set<string>()
        for (const [u, nbrs] of this.adj) {
            for (const [v, w] of nbrs) {
                const key = u < v ? `${u}|${v}` : `${v}|${u}`
                if (seen.has(key)) continue
                seen.add(key)
                adjList.push([u, v, w])
            }
        }
        const postingsObj: Record<string, string[]> = {}
        for (const [e, set] of this.postings) postingsObj[e] = Array.from(set)
        const simObj: Record<string, string[]> = {}
        for (const [k, ents] of this.simhashEntities) simObj[k] = ents.slice()
        return { adj: adjList, postings: postingsObj, simhashEntities: simObj }
    }

    public static fromJSON(obj: SerializedKGIndex): HippoGraphIndex {
        const kg = new HippoGraphIndex()
        if (obj?.adj && Array.isArray(obj.adj)) {
            for (const [u, v, w] of obj.adj as [string, string, number][]) {
                kg.addRelationEdge(u, v, w ?? 1)
            }
        }
        if (obj?.postings) {
            for (const e of Object.keys(obj.postings)) {
                const arr = obj.postings[e] as string[]
                kg.postings.set(e, new Set(arr))
            }
        }
        if (obj?.simhashEntities) {
            for (const k of Object.keys(obj.simhashEntities)) {
                kg.simhashEntities.set(k, obj.simhashEntities[k])
            }
        }
        return kg
    }
}
