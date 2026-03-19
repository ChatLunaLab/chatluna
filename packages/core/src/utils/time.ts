/**
 * Format milliseconds to a human-readable time string.
 * @param ms - Time in milliseconds
 * @returns Formatted time string (e.g., "1.23s", "2m 34s", "1h 23m 45s")
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`
    }

    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`
    }

    const decimal = (ms / 1000).toFixed(2)
    return `${decimal}s`
}
