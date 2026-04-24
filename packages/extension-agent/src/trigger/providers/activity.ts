import { h, Session } from 'koishi'
import { z } from 'zod'
import type { TriggerProvider } from '../../types'

const curveEnum = z.enum(['linear', 'sqrt', 'log'])
const directionEnum = z.enum(['auto', 'up', 'down'])

const activitySchema = z
    .object({
        initialScore: z.coerce
            .number()
            .default(0)
            .describe(
                '活跃度初始分。初始分小于阈值代表越聊越活，反之代表越聊越冷。'
            ),
        activeThreshold: z.coerce
            .number()
            .default(10)
            .describe(
                '达到（向上）或跌破（向下）该阈值并保持 holdMs 之后触发。'
            ),
        direction: directionEnum
            .default('auto')
            .describe(
                '触发方向：auto 由 initial 与 threshold 大小关系推断；up 仅向上跨阈值触发；down 仅向下跨阈值触发。'
            ),
        decayHalfLifeMs: z.coerce
            .number()
            .int()
            .min(1000)
            .default(2 * 60 * 1000)
            .describe(
                '指数衰减半衰期：在没有新消息的情况下，每过这段时间分数向 initialScore 收敛一半。'
            ),
        messageWeight: z.coerce
            .number()
            .default(1)
            .describe('每条群聊消息的基础权重。'),
        lengthBonusEnabled: z
            .boolean()
            .default(true)
            .describe('启用消息长度加成。'),
        lengthBonusCharsPerPoint: z.coerce
            .number()
            .int()
            .min(1)
            .default(40)
            .describe('每多少字符 +1 长度加成单位。'),
        lengthBonusMax: z.coerce
            .number()
            .min(0)
            .default(2)
            .describe('单条消息长度加成上限（叠加在权重上）。'),
        mentionBonus: z.coerce
            .number()
            .min(0)
            .default(0.4)
            .describe('消息中含 @mention 时的额外权重。'),
        quoteBonus: z.coerce
            .number()
            .min(0)
            .default(0.5)
            .describe('消息为引用回复时的额外权重。'),
        mediaBonus: z.coerce
            .number()
            .min(0)
            .default(0.6)
            .describe('消息含媒体（图片/语音/视频/文件等）时的额外权重。'),
        emojiOnlyPenalty: z.coerce
            .number()
            .min(0)
            .max(1)
            .default(0.3)
            .describe('内容仅由 emoji/标点构成时的权重倍率。'),
        boostKeywords: z
            .array(z.string().min(1))
            .default([])
            .describe('命中后给消息额外加权的关键词列表（不区分大小写）。'),
        boostKeywordFactor: z.coerce
            .number()
            .min(0)
            .default(0.8)
            .describe('每命中一个 boost 关键词增加的权重单位。'),
        minDistinctUsers: z.coerce
            .number()
            .int()
            .min(1)
            .default(2)
            .describe('窗口内最少参与人数门槛，未达到时权重会被显著抑制。'),
        distinctUserCurve: curveEnum
            .default('sqrt')
            .describe(
                '参与人数加成曲线：linear 线性 / sqrt 开平方 / log 自然对数。'
            ),
        distinctUserGain: z.coerce
            .number()
            .min(0)
            .default(0.6)
            .describe('参与人数加成系数。'),
        sameUserPenalty: z.coerce
            .number()
            .min(0)
            .max(1)
            .default(0.6)
            .describe('同一用户连续发言时的几何衰减底数（连续 N 次乘 N 次）。'),
        burstIntervalMs: z.coerce
            .number()
            .int()
            .min(0)
            .default(1500)
            .describe('低于该间隔的相邻消息视为刷屏。'),
        burstPenalty: z.coerce
            .number()
            .min(0)
            .max(1)
            .default(0.4)
            .describe('刷屏消息的权重倍率。'),
        silenceBoostMs: z.coerce
            .number()
            .int()
            .min(0)
            .default(10 * 60 * 1000)
            .describe('静默时间超过该值后下一条消息视为破冰。'),
        silenceBoostFactor: z.coerce
            .number()
            .min(1)
            .default(1.6)
            .describe('破冰消息的权重倍率。'),
        windowMs: z.coerce
            .number()
            .int()
            .min(1000)
            .default(5 * 60 * 1000)
            .describe('滑动窗口长度，用于统计参与者与速率。'),
        windowMaxMessages: z.coerce
            .number()
            .int()
            .min(8)
            .default(120)
            .describe('滑动窗口内最多保留多少条消息样本。'),
        holdMs: z.coerce
            .number()
            .int()
            .min(0)
            .default(20 * 1000)
            .describe('分数跨过阈值后必须持续保持的时间，防止瞬时尖峰误触。'),
        cooldownMs: z.coerce
            .number()
            .int()
            .min(1000)
            .default(15 * 60 * 1000)
            .describe('同一任务再次触发前的最小冷却时间。'),
        recoveryMs: z.coerce
            .number()
            .int()
            .min(1000)
            .default(3 * 60 * 1000)
            .describe(
                '触发后将分数拉回 initialScore 并在该时间内禁止再次跨越阈值。'
            ),
        idleTimeoutMs: z.coerce
            .number()
            .int()
            .min(60 * 1000)
            .default(60 * 60 * 1000)
            .describe('长时间无活动后彻底删除内存状态。')
    })
    .refine((v) => v.initialScore !== v.activeThreshold, {
        message: '初始分不能等于阈值，否则触发方向无意义。'
    })

type ActivityParams = z.infer<typeof activitySchema>
type Direction = 'up' | 'down'

interface MessageSample {
    at: number
    userId: string
    weight: number
}

interface ActivityState {
    score: number
    lastDecayAt: number
    lastMessageAt: number
    samples: MessageSample[]
    consecutiveBy: { userId: string | null; count: number }
    crossSince: number | null
    cooldownUntil: number
    lastTouched: number
}

const STATE_LIMIT = 512
const states = new Map<number, ActivityState>()

function resolveDirection(params: ActivityParams): Direction {
    if (params.direction === 'up') return 'up'
    if (params.direction === 'down') return 'down'
    return params.initialScore < params.activeThreshold ? 'up' : 'down'
}

function decayTowards(
    score: number,
    initial: number,
    elapsedMs: number,
    halfLifeMs: number
): number {
    if (elapsedMs <= 0 || halfLifeMs <= 0) return score
    const factor = Math.pow(0.5, elapsedMs / halfLifeMs)
    return initial + (score - initial) * factor
}

function curveGain(
    distinct: number,
    minDistinct: number,
    curve: ActivityParams['distinctUserCurve'],
    gain: number
): number {
    if (distinct < minDistinct) return -0.5
    const excess = distinct - minDistinct + 1
    let value: number
    switch (curve) {
        case 'linear':
            value = excess
            break
        case 'sqrt':
            value = Math.sqrt(excess)
            break
        case 'log':
            value = Math.log1p(excess)
            break
    }
    return value * gain
}

function gcStates(now: number, idleTimeoutMs: number) {
    if (states.size <= STATE_LIMIT) {
        for (const [id, state] of states) {
            if (now - state.lastTouched > idleTimeoutMs) {
                states.delete(id)
            }
        }
        return
    }
    const sorted = [...states.entries()].sort(
        (a, b) => a[1].lastTouched - b[1].lastTouched
    )
    const drop = sorted.length - Math.floor(STATE_LIMIT * 0.8)
    for (let i = 0; i < drop; i++) {
        states.delete(sorted[i][0])
    }
}

function pruneSamples(
    state: ActivityState,
    now: number,
    params: ActivityParams
) {
    const cutoff = now - params.windowMs
    while (state.samples.length > 0 && state.samples[0].at < cutoff) {
        state.samples.shift()
    }
    while (state.samples.length > params.windowMaxMessages) {
        state.samples.shift()
    }
}

function computeWeight(
    raw: string,
    elements: ReturnType<typeof selectElements>,
    sample: { sameAsPrev: boolean; intervalMs: number; sinceLastMs: number },
    distinct: number,
    consecutive: number,
    params: ActivityParams
): number {
    let weight = params.messageWeight

    if (params.lengthBonusEnabled) {
        const points = Math.min(
            params.lengthBonusMax,
            raw.length / params.lengthBonusCharsPerPoint
        )
        weight += points
    }

    if (elements.hasMention) weight += params.mentionBonus
    if (elements.hasQuote) weight += params.quoteBonus
    if (elements.hasMedia) weight += params.mediaBonus

    if (raw.length > 0 && elements.isEmojiOnly) {
        weight *= params.emojiOnlyPenalty
    }

    if (params.boostKeywords.length > 0) {
        const lower = raw.toLowerCase()
        let hits = 0
        for (const kw of params.boostKeywords) {
            if (lower.includes(kw.toLowerCase())) hits++
        }
        if (hits > 0) weight += hits * params.boostKeywordFactor
    }

    weight += curveGain(
        distinct,
        params.minDistinctUsers,
        params.distinctUserCurve,
        params.distinctUserGain
    )

    if (sample.sameAsPrev && consecutive > 1) {
        weight *= Math.pow(params.sameUserPenalty, consecutive - 1)
    }

    if (sample.intervalMs >= 0 && sample.intervalMs < params.burstIntervalMs) {
        weight *= params.burstPenalty
    }

    if (sample.sinceLastMs >= params.silenceBoostMs) {
        weight *= params.silenceBoostFactor
    }

    return weight
}

function selectElements(session: Session) {
    const elements = (session.elements ?? []) as h[]
    let hasMention = false
    let hasMedia = false
    for (const el of elements) {
        if (el?.type === 'at') hasMention = true
        if (
            el?.type === 'img' ||
            el?.type === 'image' ||
            el?.type === 'audio' ||
            el?.type === 'video' ||
            el?.type === 'file'
        ) {
            hasMedia = true
        }
    }
    const text = h
        .select(elements as h[], 'text')
        .join('')
        .trim()
    const isEmojiOnly =
        text.length > 0 &&
        /^[\p{Emoji}\p{P}\p{S}\s]+$/u.test(text) &&
        !/[\p{L}\p{N}]/u.test(text)
    return {
        hasMention,
        hasMedia,
        hasQuote: session.quote != null,
        isEmojiOnly
    }
}

export const activityTriggerProvider: TriggerProvider = {
    kind: 'activity',
    name: '活跃度',
    description:
        '仅对群聊生效。综合多人参与度、消息长度/媒体/引用、刷屏与破冰、同人连发等多维度，计算带指数衰减的活跃度分数，并在分数跨越阈值并持续 holdMs 后唤醒代理。',
    passive: true,
    needsMessage: false,
    schema: activitySchema,
    prepare({ input }) {
        const parsed = activitySchema.parse(input.params ?? {})
        return {
            nextFireAt: null,
            params: {
                ...input.params,
                ...parsed
            }
        }
    },
    match({ session, task, content }) {
        if (session.isDirect || !session.guildId) return null

        const parsed = activitySchema.safeParse(task.params ?? {})
        if (!parsed.success) return null
        const params = parsed.data
        const direction = resolveDirection(params)

        const now = Date.now()
        if (states.size > STATE_LIMIT) gcStates(now, params.idleTimeoutMs)

        let state = states.get(task.id)
        if (state != null && now - state.lastTouched > params.idleTimeoutMs) {
            states.delete(task.id)
            state = undefined
        }

        if (state == null) {
            state = {
                score: params.initialScore,
                lastDecayAt: now,
                lastMessageAt: now,
                samples: [],
                consecutiveBy: { userId: null, count: 0 },
                crossSince: null,
                cooldownUntil: 0,
                lastTouched: now
            }
            states.set(task.id, state)
        }

        // 1. 衰减到当下
        const elapsed = now - state.lastDecayAt
        state.score = decayTowards(
            state.score,
            params.initialScore,
            elapsed,
            params.decayHalfLifeMs
        )
        state.lastDecayAt = now
        state.lastTouched = now

        // 2. 累积本条消息
        const userId = session.userId ?? 'unknown'
        const previousMessageAt = state.lastMessageAt
        const intervalMs =
            state.samples.length > 0
                ? now - state.samples[state.samples.length - 1].at
                : -1
        const sinceLastMs = now - previousMessageAt

        if (state.consecutiveBy.userId === userId) {
            state.consecutiveBy.count += 1
        } else {
            state.consecutiveBy.userId = userId
            state.consecutiveBy.count = 1
        }

        pruneSamples(state, now, params)
        const users = new Set(state.samples.map((sample) => sample.userId))
        const distinct = users.has(userId) ? users.size : users.size + 1

        const elements = selectElements(session)
        const rawText = content ?? ''
        const weight = computeWeight(
            rawText,
            elements,
            {
                sameAsPrev: state.consecutiveBy.count > 1,
                intervalMs,
                sinceLastMs
            },
            distinct,
            state.consecutiveBy.count,
            params
        )

        if (direction === 'up') {
            state.score += weight
        } else {
            state.score -= weight
        }

        state.samples.push({ at: now, userId, weight })
        state.lastMessageAt = now
        pruneSamples(state, now, params)

        // 3. 冷却期内压回初始分，禁止触发
        if (now < state.cooldownUntil) {
            state.score = decayTowards(
                state.score,
                params.initialScore,
                Math.max(1, params.recoveryMs / 4),
                params.recoveryMs
            )
            return null
        }

        const crossed =
            direction === 'up'
                ? state.score >= params.activeThreshold
                : state.score <= params.activeThreshold

        if (!crossed) {
            state.crossSince = null
            return null
        }

        if (state.crossSince == null) state.crossSince = now
        if (now - state.crossSince < params.holdMs) return null

        // 4. 计算窗口内速率
        let momentum = 0
        if (state.samples.length >= 2) {
            const sum = state.samples.reduce((a, s) => a + s.weight, 0)
            const span =
                (state.samples[state.samples.length - 1].at -
                    state.samples[0].at) /
                1000
            momentum = span > 0 ? sum / span : sum
        }

        const detail = {
            score: Number(state.score.toFixed(3)),
            initialScore: params.initialScore,
            threshold: params.activeThreshold,
            direction,
            distinctUsers: distinct,
            consecutiveSameUser: state.consecutiveBy.count,
            momentumPerSec: Number(momentum.toFixed(3)),
            heldMs: now - state.crossSince,
            windowMessages: state.samples.length
        }

        // 5. 触发后进入冷却恢复
        state.score = params.initialScore
        state.crossSince = null
        state.cooldownUntil =
            now + Math.max(params.cooldownMs, params.recoveryMs)
        state.consecutiveBy = { userId: null, count: 0 }

        return {
            message: task.wakeupTemplate.message ?? rawText,
            detail
        }
    },
    afterFire() {
        return {
            enabled: true,
            nextFireAt: null
        }
    },
    onTaskRemove({ task }) {
        states.delete(task.id)
    }
}
