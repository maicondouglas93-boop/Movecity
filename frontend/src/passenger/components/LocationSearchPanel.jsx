import React, { useState } from 'react'
import { getPlaceDetails, getAddressSuggestions } from '@/shared/services/mapsApi'
import { QUICK_PLACES } from '@/shared/assets/quickPlaces/quickPlaces'
import { useToast } from '@/shared/contexts/ToastContext'

const LocationSearchPanel = ({ suggestions, setVehiclePanel, setPanelOpen, setPickup, setDestination, activeField, setIsSelectingOnMap, isSearching, sessionToken }) => {
    const [ resolvingKey, setResolvingKey ] = useState(null)
    const [ resolvingQuickPlaceId, setResolvingQuickPlaceId ] = useState(null)
    const { addToast } = useToast()

    const handleSuggestionClick = async (suggestion) => {
        if (typeof suggestion === 'string') {
            if (activeField === 'pickup') {
                setPickup(suggestion)
            } else if (activeField === 'destination') {
                setDestination(suggestion)
            }
            return
        }

        // Provider osm/nominatim já traz lat/lng direto na sugestão — comportamento original.
        if (suggestion.lat !== undefined && suggestion.lng !== undefined) {
            const val = {
                address: suggestion.title + (suggestion.subtitle ? ` - ${suggestion.subtitle}` : ''),
                lat: suggestion.lat,
                lng: suggestion.lng
            }
            if (activeField === 'pickup') {
                setPickup(val)
            } else if (activeField === 'destination') {
                setDestination(val)
            }
            return
        }

        // Provider google (Places New): sugestão só tem placeId, resolve as coordenadas
        // agora — só na seleção, não a cada tecla digitada (ver Etapa 3 do plano).
        if (suggestion.placeId) {
            setResolvingKey(suggestion.placeId)
            try {
                const details = await getPlaceDetails(suggestion.placeId, sessionToken)
                const val = {
                    address: details.address || suggestion.title,
                    lat: details.ltd,
                    lng: details.lng
                }
                if (activeField === 'pickup') {
                    setPickup(val)
                } else if (activeField === 'destination') {
                    setDestination(val)
                }
            } catch (err) {
                console.error('Falha ao resolver detalhes do local:', err)
            } finally {
                setResolvingKey(null)
            }
        }
    }

    // Atalho fixo (igreja, pronto-socorro, mercados locais...): busca pelo NOME na
    // mesma API de autocomplete que o campo de texto já usa, em vez de fixar
    // lat/lng aqui. A coordenada exata sempre vem do provider de mapas configurado
    // (Google Places ou OSM) — reaproveita o mesmo pipeline de resolução da busca
    // manual (handleSuggestionClick), só pulando a etapa de digitar.
    const handleQuickPlaceClick = async (place) => {
        setResolvingQuickPlaceId(place.id)
        try {
            const { suggestions: found } = await getAddressSuggestions({ input: place.query, sessionToken })
            const best = found[0]
            if (!best) {
                // Falhar em silêncio aqui é o pior caso: o passageiro toca, nada
                // acontece, e não há nenhuma pista de que a busca não encontrou o
                // local (foi exatamente o que aconteceu com "Paróquia N. Sra. de
                // Nazaré" — o app só logava no console, que ninguém vê em produção).
                console.error(`Nenhum resultado de mapa para o local fixo "${place.label}"`)
                addToast(`Não encontrei "${place.label}" no mapa agora. Digite o endereço manualmente.`, 'error')
                return
            }
            await handleSuggestionClick(best)
        } catch (err) {
            console.error(`Falha ao buscar local fixo "${place.label}":`, err)
            addToast(`Não consegui buscar "${place.label}" agora. Tente digitar o endereço.`, 'error')
        } finally {
            setResolvingQuickPlaceId(null)
        }
    }

    return (
        <div>
            <div className="mb-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1 pt-1 pb-2">Locais frequentes</p>
                {QUICK_PLACES.map((place) => {
                    const isResolving = resolvingQuickPlaceId === place.id
                    return (
                        <div
                            key={place.id}
                            onClick={() => !resolvingQuickPlaceId && handleQuickPlaceClick(place)}
                            className={`flex gap-4 p-3 border-b border-gray-100 active:bg-green-50 items-center justify-start cursor-pointer transition-colors ${resolvingQuickPlaceId && !isResolving ? 'opacity-50 pointer-events-none' : ''}`}
                        >
                            <div className='relative h-9 w-9 flex-shrink-0'>
                                <img
                                    src={place.icon}
                                    alt=""
                                    className='h-9 w-9 rounded-full object-cover border border-gray-200'
                                />
                                {isResolving && (
                                    <div className='absolute inset-0 flex items-center justify-center bg-white/70 rounded-full'>
                                        <i className="ri-loader-4-line text-lg text-green-500 animate-spin"></i>
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <h4 className='font-bold text-gray-800 text-[15px] truncate'>{place.label}</h4>
                                <p className='text-sm text-gray-500 truncate'>{place.subtitle}</p>
                            </div>
                        </div>
                    )
                })}
            </div>
            {isSearching ? (
                <div className="flex flex-col items-center justify-center py-10 text-green-500">
                    <i className="ri-loader-4-line text-3xl animate-spin mb-2"></i>
                    <p className="text-gray-500">Buscando sugestões...</p>
                </div>
            ) : suggestions.length > 0 ? (
                suggestions.map((elem, idx) => {
                    const isString = typeof elem === 'string';
                    const title = isString ? elem : elem.title;
                    const subtitle = isString ? '' : elem.subtitle;
                    const isResolving = !isString && elem.placeId && resolvingKey === elem.placeId;

                    return (
                        <div key={idx} onClick={() => handleSuggestionClick(elem)} className='flex gap-4 p-3 border-b border-gray-100 active:bg-green-50 items-center justify-start cursor-pointer transition-colors'>
                            <h2 className='text-green-500 h-8 w-8 flex items-center justify-center rounded-full'>
                                <i className={isResolving ? "ri-loader-4-line text-xl animate-spin" : "ri-map-pin-fill text-xl"}></i>
                            </h2>
                            <div className="flex flex-col overflow-hidden">
                                <h4 className='font-bold text-gray-800 text-[15px] truncate'>{title}</h4>
                                {subtitle && <p className='text-sm text-gray-500 truncate'>{subtitle}</p>}
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="text-center text-gray-400 py-5">
                    Nenhuma sugestão encontrada
                </div>
            )}

            <div onClick={() => {
                setPanelOpen(false);
                if (typeof setIsSelectingOnMap === 'function') {
                    setIsSelectingOnMap(true);
                }
            }} className='flex gap-4 p-3 border-t border-gray-100 active:bg-green-50 items-center mt-2 justify-start cursor-pointer transition-colors'>
                <h2 className='text-green-500 h-8 w-8 flex items-center justify-center rounded-full'>
                    <i className="ri-pushpin-2-fill text-xl"></i>
                </h2>
                <h4 className='font-semibold text-gray-800 text-[15px]'>Escolher no mapa</h4>
            </div>
        </div>
    )
}

export default LocationSearchPanel
