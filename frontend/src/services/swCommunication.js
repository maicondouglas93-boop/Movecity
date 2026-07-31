export const syncTokenWithSW = (token) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SYNC_TOKEN',
            token: token
        });
    }
}

export const clearTokenInSW = () => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'CLEAR_TOKEN'
        });
    }
}
