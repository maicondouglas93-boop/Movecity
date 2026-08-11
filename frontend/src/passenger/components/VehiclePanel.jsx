import React, { useEffect, useState } from 'react'
import { vehicleImages } from '@/shared/assets/vehicleAssets'
import { getVehicleCategories } from '@/shared/services/vehicleCategoriesApi'
import SelectableOptionCard from '@/shared/components/ui/SelectableOptionCard'
import Button from '@/shared/components/ui/Button'
import { formatCurrencyBRL } from '@/shared/utils/formatters'

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

    return (
        <div className='pb-2'>
            <h3 className='text-base font-semibold mb-2.5 text-ink-900'>Escolha um veículo</h3>

            {loading ? (
                <div className='flex justify-center py-5'>
                    <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                </div>
            ) : categories.length === 0 ? (
                <p className='text-center text-ink-400 py-5 text-sm'>Nenhuma categoria de veículo disponível no momento.</p>
            ) : (
                <div className='flex flex-col gap-1.5'>
                    {categories.map((category) => (
                        <SelectableOptionCard
                            key={category._id || category.name}
                            selected={selectedName === category.name}
                            onClick={() => setSelectedName(category.name)}
                            icon={<img className='h-9 w-12 object-contain' src={vehicleImages[category.iconKey] || vehicleImages[category.name] || vehicleImages.car} alt="" width="1024" height="1024" loading="lazy" />}
                            title={
                                <span className='inline-flex items-center gap-1.5'>
                                    {category.displayName}
                                    <span className='inline-flex items-center gap-0.5 text-xs text-ink-400 font-normal'>
                                        <i className="ri-user-3-fill" aria-hidden="true"></i>{category.capacity}
                                    </span>
                                </span>
                            }
                            subtitle={category.description}
                            trailing={
                                <span className='text-base font-bold text-ink-900'>
                                    {props.fare?.fare?.[category.name] != null ? formatCurrencyBRL(props.fare.fare[category.name]) : ''}
                                </span>
                            }
                        />
                    ))}
                </div>
            )}

            {/* Bloco H (2026-08-02): antes este aviso era fixo — o toggle "Exibir Valor
                como Estimativa" do painel admin (showAsEstimate) nunca tinha efeito
                nenhum, ligado ou desligado. */}
            {props.fare?.showAsEstimate !== false && (
                <p className='text-[11px] text-center text-ink-400 mt-2.5 px-2'>
                    Valor estimado — o final depende da distância real.
                </p>
            )}

            <Button onClick={handleContinue} disabled={!selectedName} className='mt-3 !min-h-[44px] !text-sm'>
                Continuar
            </Button>
        </div>
    )
}

export default VehiclePanel
