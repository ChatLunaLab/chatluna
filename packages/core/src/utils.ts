
export function runPromiseByQueue(myPromises: Promise<any>[]) {
    return myPromises.reduce(
        (previousPromise, nextPromise) => previousPromise.then(() => nextPromise),
        Promise.resolve()
    );
}
