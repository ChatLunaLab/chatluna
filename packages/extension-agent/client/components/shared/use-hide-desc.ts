import { computed, ref } from 'vue'
import type { Ref } from 'vue'

export interface PagePrefs {
    skills: boolean
    mcp: boolean
    tool: boolean
    subAgent: boolean
    computer: boolean
}

const DESC_KEY = 'chatluna-agent-hide-desc'
const COMPACT_KEY = 'chatluna-agent-compact-mode'

function readState(key: string) {
    if (typeof window === 'undefined') {
        return false
    }

    const raw = window.localStorage.getItem(key)
    if (!raw) {
        return false
    }

    try {
        const value = JSON.parse(raw)
        if (typeof value === 'boolean') {
            return value
        }

        if (value && typeof value === 'object') {
            return Object.values(value).some(Boolean)
        }

        return false
    } catch {
        return false
    }
}

function writeState(key: string, value: boolean) {
    if (typeof window === 'undefined') {
        return
    }

    window.localStorage.setItem(key, JSON.stringify(value))
}

const hideDesc = ref(readState(DESC_KEY))
const compactMode = ref(readState(COMPACT_KEY))

function usePagePref(key: string, state: Ref<boolean>) {
    return computed({
        get() {
            return state.value
        },
        set(value: boolean) {
            state.value = value
            writeState(key, value)
        }
    })
}

export function useHideDesc(_name: keyof PagePrefs) {
    return usePagePref(DESC_KEY, hideDesc)
}

export function useCompactMode(_name: keyof PagePrefs) {
    return usePagePref(COMPACT_KEY, compactMode)
}
