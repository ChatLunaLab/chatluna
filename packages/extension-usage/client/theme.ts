import { computed, ref } from 'vue'

const tick = ref(0)

function read(version: number, name: string) {
    if (typeof window === 'undefined') return ''
    return getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim()
}

function color(version: number, name: string, fallback: string) {
    return read(version, name) || read(version, fallback)
}

function refresh() {
    tick.value += 1
}

if (typeof window !== 'undefined') {
    window.requestAnimationFrame(refresh)

    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
    })

    if (document.body) {
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style']
        })
    }
}

export const chartTheme = computed(() => {
    const version = tick.value

    return {
        key: String(version),
        text: color(version, '--k-text-dark', '--el-text-color-primary'),
        muted: color(version, '--k-text-light', '--el-text-color-regular'),
        brand: color(version, '--k-color-primary', '--el-color-primary'),
        success: color(version, '--k-color-success', '--el-color-success'),
        warning: color(version, '--k-color-warning', '--el-color-warning'),
        danger: color(version, '--k-color-danger', '--el-color-danger'),
        info: color(version, '--k-color-info', '--el-color-info'),
        border: color(version, '--k-card-border', '--k-color-divider'),
        grid: color(version, '--k-color-divider', '--el-border-color-lighter'),
        surface: color(version, '--k-card-bg', '--el-bg-color')
    }
})
