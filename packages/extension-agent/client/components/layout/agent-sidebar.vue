<template>
    <div class="side-nav">
        <div class="nav-segment" :style="{ '--nav-index': active }">
            <div class="nav-pill" />
            <div
                v-for="item in items"
                :key="item.key"
                class="nav-item"
                :class="{ active: current === item.key }"
                @click="$emit('select', item.key)"
            >
                <el-icon :size="24">
                    <component :is="item.icon" />
                </el-icon>
                <span class="nav-label">{{ item.label }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import {
    AlarmClock,
    Connection,
    MagicStick,
    Monitor,
    Tools,
    UserFilled
} from '@element-plus/icons-vue'

const props = defineProps<{
    current: string
}>()

defineEmits<{
    select: [key: string]
}>()

const items = [
    { key: 'mcp', label: 'MCP', icon: Connection },
    { key: 'skills', label: '技能', icon: MagicStick },
    { key: 'computer', label: '电脑', icon: Monitor },
    { key: 'subAgent', label: '子代理', icon: UserFilled },
    { key: 'tool', label: '工具', icon: Tools },
    { key: 'trigger', label: '触发器', icon: AlarmClock }
]

const active = computed(() =>
    items.findIndex((item) => item.key === props.current)
)
</script>

<style scoped>
.side-nav {
    position: fixed;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    box-sizing: border-box;
    background: var(--k-card-bg);
    box-shadow: var(--k-card-shadow);
    border: 1px solid var(--k-color-divider);
    border-radius: 16px;
    padding: 12px;
    z-index: 100;
    transition: width 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    width: 64px;
    overflow: hidden;
}

.side-nav:is(:hover, :focus-within) {
    width: 188px;
}

.nav-segment {
    --nav-index: 0;
    --nav-step: 52px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    isolation: isolate;
}

.nav-pill {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 40px;
    border-radius: 10px;
    background: var(--k-hover-bg);
    transform: translateY(calc(var(--nav-index) * var(--nav-step)));
    transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    will-change: transform;
}

.nav-item {
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 12px;
    cursor: pointer;
    color: var(--k-text-light);
    overflow: hidden;
    transition:
        color 0.2s ease,
        background-color 0.2s ease;
    white-space: nowrap;
    position: relative;
    z-index: 1;
}

.nav-item:hover {
    color: var(--k-text-dark);
}

.nav-item.active {
    color: var(--k-color-primary);
    font-weight: 500;
}

.nav-item .el-icon {
    flex: 0 0 24px;
    display: flex;
    min-width: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
}

.nav-label {
    display: block;
    max-width: 0;
    overflow: hidden;
    opacity: 0;
    transform: translateX(-6px);
    transition:
        max-width 0.32s cubic-bezier(0.22, 1, 0.36, 1),
        opacity 0.16s ease 0.12s,
        transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    font-size: 14px;
}

.side-nav:is(:hover, :focus-within) .nav-label {
    max-width: 96px;
    opacity: 1;
    transform: translateX(0);
    transition-delay: 0.04s, 0.08s, 0.04s;
}

@media (max-width: 768px) {
    .side-nav {
        top: auto;
        bottom: 20px;
        right: 50%;
        transform: translateX(50%);
        width: auto;
        padding: 8px 16px;
        border-radius: 30px;
    }

    .side-nav:is(:hover, :focus-within) {
        width: auto;
    }

    .nav-segment {
        flex-direction: row;
        gap: 20px;
    }

    .nav-pill {
        display: none;
    }

    .nav-item {
        padding: 0;
        gap: 0;
        height: auto;
        background: transparent !important;
        box-shadow: none !important;
        color: var(--k-text-light);
    }

    .nav-item.active {
        color: var(--k-color-primary);
    }

    .nav-label {
        display: none;
    }

    .nav-item .el-icon,
    .side-nav:is(:hover, :focus-within) .nav-item .el-icon {
        flex-basis: 24px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .side-nav,
    .nav-item,
    .nav-label,
    .nav-pill {
        transition-duration: 0.01ms !important;
        transition-delay: 0s !important;
    }

    .nav-label {
        transform: none;
    }
}
</style>
