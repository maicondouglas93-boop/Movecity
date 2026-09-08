// Um evento cancelável permite ao atendimento/menu consumir Voltar antes da rota.
// Não chama APIs e nunca recusa, cancela ou finaliza um serviço.
export const DRIVER_OVERLAY_BACK = 'movecity:driver-overlay-back'

export function dismissDriverOverlay() {
    return !window.dispatchEvent(new Event(DRIVER_OVERLAY_BACK, { cancelable: true }))
}
