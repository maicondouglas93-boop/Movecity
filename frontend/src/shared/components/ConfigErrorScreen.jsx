import { apiBaseConfigError } from '@/shared/services/apiBase'

/**
 * Build sem VITE_BASE_URL: em vez de deixar o motorista bater em "email ou senha
 * incorretos" (o sintoma que o app dava), diz o que realmente aconteceu.
 */
export default function ConfigErrorScreen() {
    const message = apiBaseConfigError()

    return (
        <div className="min-h-screen bg-[#0B3D2E] text-white flex items-center justify-center px-6">
            <div className="max-w-sm w-full text-center">
                <i className="ri-plug-line text-5xl text-amber-300" aria-hidden="true" />
                <h1 className="mt-4 text-xl font-bold">Aplicativo mal configurado</h1>
                <p className="mt-3 text-sm text-white/80 leading-snug">{message}</p>
                <p className="mt-4 text-xs text-white/60 leading-snug">
                    Esta versão do app não consegue se conectar ao servidor. Não é problema
                    da sua conta nem da sua internet. Baixe a versão mais recente ou fale
                    com o suporte informando este aviso.
                </p>
            </div>
        </div>
    )
}
