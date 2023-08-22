export class ObjectLock {
    private _lock: boolean = false


    async lock() {
        while (this._lock) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }

        this._lock = true
    }

    async unlock() {
        while (!this._lock) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }

        this._lock = false
    }

    get isLocked() {
        return this._lock
    }
}