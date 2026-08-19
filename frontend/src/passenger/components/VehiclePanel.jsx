import React, { useEffect, useState } from 'react'
import { vehicleImageFor } from '@/shared/assets/vehicleAssets'
import { getVehicleCategories } from '@/shared/services/vehicleCategoriesApi'
import Button from '@/shared/components/ui/Button'
import { formatCurrencyBRL } from '@/shared/utils/formatters'

// Paleta dos ladrilhos de imagem. Indexada pela ORDEM da categoria, não pelo nome: as
// categorias são cadastradas pelo admin e podem mudar, então amarrar cor a nome
// deixaria categoria nova sem identidade. Assim qualquer conjunto sai distinto e
// harmônico, e a cor é só apresentação — nenhum dado novo por trás.
const TILES = [
    { tile: 'bg-brand-50', chip: 'bg-brand-100 text-brand-600' },
    { tile: 'bg-sky-50', chip: 'bg-sky-100 text-sky-600' },
    { tile: 'bg-orange-50', chip: 'bg-orange-100 text-orange-600' },
    { tile: 'bg-violet-50', chip: 'bg-violet-100 text-violet-600' },
    { tile: 'bg-rose-50', chip: 'bg-rose-100 text-rose-600' },
]

// Ícone que resume o serviço, derivado do que a categoria já traz (iconKey/nome). É
// leitura do dado existente, não campo novo.
const serviceIcon = (category) => {
    const key = String(category?.iconKey || category?.name || '').toLowerCase()
    if (key.includes('moto')) return 'ri-e-bike-2-fill'
    if (key.includes('picape') || key.includes('frete') || key.includes('pickup')) return 'ri-box-3-fill'
    if (key.includes('rural') || key.includes('suv')) return 'ri-mountain-fill'
    return 'ri-user-3-fill'
}

// Antes, tocar numa categoria já navegava direto pra confirmação — o usuário nunca via
// o que tinha escolhido até a tela seguinte. Agora o toque só seleciona (card destacado)
// e um botão "Continuar" separado avança — mesmo padrão de apps de referência.
// Ver §2.4/item da auditoria de UX.
const VehiclePanel = (props) => {
    // Corrida normal usa service=ride — categorias só de encomenda (allowedServices.ride=false) não entram.
    const service = props.service || 'ride'
    const [categories, setCategories] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedName, setSelectedName] = useState(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        getVehicleCategories(service)
            .then((data) => {
                if (!cancelled) setCategories(Array.isArray(data) ? data : [])
            })
            .catch(() => {
                if (!cancelled) setCategories([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => { cancelled = true }
    }, [service])

    const handleContinue = () => {
        if (!selectedName) return
        props.selectVehicle(selectedName)
        props.setConfirmRidePanel(true)
    }

    const mostraEstimativa = props.fare?.showAsEstimate !== false

    return (
        <div className='pb-2'>
            <h3 className='text-lg font-bold text-ink-900'>Escolha um veículo</h3>
            <p className='text-sm text-ink-400 mb-3'>Selecione a opção ideal para sua viagem</p>

            {loading ? (
                <div className='flex justify-center py-5'>
                    <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                </div>
            ) : categories.length === 0 ? (
                <p className='text-center text-ink-400 py-5 text-sm'>Nenhuma categoria de veículo disponível no momento.</p>
            ) : (
                <div className='flex flex-col gap-2'>
                    {categories.map((category, index) => {
                        const selected = selectedName === category.name
                        const paleta = TILES[index % TILES.length]
                        const preco = props.fare?.fare?.[category.name]

                        return (
                            <button
                                key={category._id || category.name}
                                type="button"
                                onClick={() => setSelectedName(category.name)}
                                aria-pressed={selected}
                                className={`w-full flex items-center gap-3 p-2.5 rounded-panel border-2 text-left transition-colors active:scale-[0.99] ${
                                    selected ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'
                                }`}
                            >
                                <div className={`flex-shrink-0 h-16 w-20 rounded-xl flex items-center justify-center ${paleta.tile}`}>
                                    <img
                                        className='h-11 w-16 object-contain'
                                        src={vehicleImageFor(category)}
                                        alt=""
                                        loading="lazy"
                                    />
                                </div>

                                <div className='flex-1 min-w-0'>
                                    <div className='flex items-center gap-1.5'>
                                        <span className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center ${paleta.chip}`}>
                                            <i className={`${serviceIcon(category)} text-[11px]`} aria-hidden="true"></i>
                                        </span>
                                        <span className='font-bold text-ink-900 text-[15px] truncate'>{category.displayName}</span>
                                        <span className='flex-shrink-0 inline-flex items-center gap-0.5 text-xs text-ink-400'>
                                            <i className="ri-user-3-fill" aria-hidden="true"></i>{category.capacity}
                                        </span>
                                    </div>

                                    {category.description && (
                                        <p className='text-[13px] text-ink-400 truncate mt-0.5'>{category.description}</p>
                                    )}

                                    {/* Só aparece quando o admin preencheu a capacidade de bagagem no
                                        cadastro. Campo antigo que nunca tinha sido exibido — sem ele o
                                        card simplesmente não mostra a linha, em vez de inventar texto. */}
                                    {category.luggageCapacity && (
                                        <p className='text-[12px] text-ink-400 truncate mt-1 inline-flex items-center gap-1'>
                                            <i className="ri-suitcase-2-line" aria-hidden="true"></i>
                                            {category.luggageCapacity}
                                        </p>
                                    )}
                                </div>

                                <div className='flex-shrink-0 text-right pl-1'>
                                    {mostraEstimativa && preco != null && (
                                        <p className='text-[11px] text-brand-600 leading-none mb-1'>A partir de</p>
                                    )}
                                    <p className='text-base font-bold text-ink-900 leading-tight'>
                                        {preco != null ? formatCurrencyBRL(preco) : ''}
                                    </p>
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}

            {/* Bloco H (2026-08-02): antes este aviso era fixo — o toggle "Exibir Valor
                como Estimativa" do painel admin (showAsEstimate) nunca tinha efeito
                nenhum, ligado ou desligado. */}
            {mostraEstimativa && (
                <div className='flex items-start gap-2 mt-3 p-2.5 rounded-panel bg-brand-50 border border-brand-100'>
                    <i className="ri-shield-check-fill text-brand-500 text-base mt-px" aria-hidden="true"></i>
                    <div className='min-w-0'>
                        <p className='text-[13px] font-semibold text-ink-900'>Preço estimado</p>
                        <p className='text-[12px] text-ink-400'>O valor final pode variar de acordo com o trânsito e a distância.</p>
                    </div>
                </div>
            )}

            <Button onClick={handleContinue} disabled={!selectedName} className='mt-3 !min-h-[44px] !text-sm'>
                Continuar
            </Button>
        </div>
    )
}

export default VehiclePanel
