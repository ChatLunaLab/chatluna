import { computed, ref } from 'vue'
import type { Ref } from 'vue'

export interface PagePrefs {
    skills: boolean
    mcp: boolean
    tool: boolean
    subAgent: boolean
    computer: boolean
    trigger: boolean
}

const DESC_KEY = 'chatluna-agent-hide-desc'
const COMPACT_KEY = 'chatluna-agent-compact-mode'

function readState(key: string, fallback: boolean) {
    if (typeof window === 'undefined') {
        return fallback
    }

    const raw = window.localStorage.getItem(key)
    if (!raw) {
        return fallback
    }

    try {
        return JSON.parse(raw) === true
    } catch {
        return fallback
    }
}

function writeState(key: string, value: boolean) {
    if (typeof window === 'undefined') {
        return
    }

    window.localStorage.setItem(key, JSON.stringify(value))
}

const hideDesc = ref(readState(DESC_KEY, false))
const compactMode = ref(readState(COMPACT_KEY, true))

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
