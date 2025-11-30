export function deepAssign<T, U>(target: T, source1: U): T & U
export function deepAssign<T, U, V>(
    target: T,
    source1: U,
    source2: V
): T & U & V
export function deepAssign<T, U, V, W>(
    target: T,
    source1: U,
    source2: V,
    source3: W
): T & U & V & W

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepAssign(target: any, ...sources: any[]): any {
    for (const src of sources) {
        for (const key in src) {
            // Only process own properties, not inherited ones from prototype chain
            if (!Object.prototype.hasOwnProperty.call(src, key)) {
                continue
            }
            const value = src[key]
            if (
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value)
            ) {
                if (
                    !target[key] ||
                    typeof target[key] !== 'object' ||
                    target[key] === null ||
                    Array.isArray(target[key])
                ) {
                    target[key] = {}
                }
                deepAssign(target[key], value)
            } else {
                target[key] = value
            }
        }
    }
    return target
}
