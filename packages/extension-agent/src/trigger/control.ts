import { z } from 'zod'
import type { TriggerRunDecision } from '../types/trigger'
import { finishTriggerRunSchema, triggerRunDecisionSchema } from './schema'

export type FinishTriggerRunInput = z.input<typeof finishTriggerRunSchema>

export type TriggerControlResult =
    | { ok: true; decision: TriggerRunDecision }
    | {
          ok: false
          error: 'not-running' | 'already-decided' | 'invalid-decision'
          message: string
      }

export class TriggerDecisionCollector {
    decision?: TriggerRunDecision

    constructor(readonly requestId: string) {}

    submit(
        input: FinishTriggerRunInput,
        now = new Date()
    ): TriggerControlResult {
        if (this.decision != null) {
            return {
                ok: false,
                error: 'already-decided',
                message: 'This trigger run already has a decision.'
            }
        }
        const parsed = triggerRunDecisionSchema.safeParse(input)
        if (!parsed.success) {
            return {
                ok: false,
                error: 'invalid-decision',
                message: parsed.error.issues
                    .map((issue) => issue.message)
                    .join('; ')
            }
        }
        if (
            (parsed.data.type === 'pause_until' ||
                parsed.data.type === 'reschedule') &&
            new Date(parsed.data.at).valueOf() <= now.valueOf()
        ) {
            return {
                ok: false,
                error: 'invalid-decision',
                message: `${parsed.data.type} requires a future timestamp.`
            }
        }
        this.decision = parsed.data
        return { ok: true, decision: parsed.data }
    }
}

export class TriggerRunControl {
    private readonly _collectors = new Map<string, TriggerDecisionCollector>()

    create(requestId: string): TriggerDecisionCollector {
        const collector = new TriggerDecisionCollector(requestId)
        this._collectors.set(requestId, collector)
        return collector
    }

    bind(requestId: string, collector: TriggerDecisionCollector) {
        this._collectors.set(requestId, collector)
    }

    submit(
        requestId: string,
        input: FinishTriggerRunInput,
        now = new Date()
    ): TriggerControlResult {
        const collector = this._collectors.get(requestId)
        if (collector == null) {
            return {
                ok: false,
                error: 'not-running',
                message: 'No trigger run is active for this request.'
            }
        }
        return collector.submit(input, now)
    }

    get(requestId: string): TriggerDecisionCollector | undefined {
        return this._collectors.get(requestId)
    }

    remove(requestId: string): TriggerRunDecision | undefined {
        const collector = this._collectors.get(requestId)
        this._collectors.delete(requestId)
        return collector?.decision
    }

    removeCollector(collector: TriggerDecisionCollector) {
        for (const [key, value] of this._collectors) {
            if (value === collector) this._collectors.delete(key)
        }
    }

    clear() {
        this._collectors.clear()
    }
}
