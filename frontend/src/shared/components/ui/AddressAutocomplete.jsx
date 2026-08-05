import React, { useEffect, useRef, useState } from 'react'
import {
    formatAddressWithCoords,
    getAddressSuggestions,
    getPlaceDetails,
    suggestionSubtitle,
    suggestionTitle,
} from '@/shared/services/mapsApi'

/**
 * Input de endereço com autocomplete do backend (Google Places quando MAPS_PROVIDER=google).
 * onChange sempre recebe string (texto digitado ou endereço resolvido com coords embutidas).
 */
export default function AddressAutocomplete({
    id,
    label,
    value = '',
    onChange,
    /** Chamado após escolher sugestão (endereço já resolvido com coords, se disponível). */
    onResolved,
    placeholder = 'Digite o endereço',
    biasLocation = null,
    disabled = false,
    className = '',
    inputClassName = '',
    icon = 'ri-map-pin-line',
    iconClassName = 'text-brand-500',
    minChars = 3,
    debounceMs = 400,
}) {
    const [suggestions, setSuggestions] = useState([])
    const [open, setOpen] = useState(false)
    const [searching, setSearching] = useState(false)
    const [resolving, setResolving] = useState(false)
    const [sessionToken, setSessionToken] = useState(null)
    const debounceRef = useRef(null)
    const rootRef = useRef(null)
    const skipFetchRef = useRef(false)

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
    }, [])

    useEffect(() => {
        const onDocClick = (e) => {
            if (!rootRef.current?.contains(e.target)) setOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [])

    const fetchSuggestions = (input) => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        const q = String(input || '').trim()
        if (q.length < minChars) {
            setSuggestions([])
            setSearching(false)
            return
        }
        setSearching(true)
        debounceRef.current = setTimeout(async () => {
            try {
                const { suggestions: list, sessionToken: next } = await getAddressSuggestions({
                    input: q,
                    lat: biasLocation?.lat ?? biasLocation?.ltd,
                    lng: biasLocation?.lng,
                    sessionToken,
                })
                setSuggestions(list.slice(0, 8))
                if (next) setSessionToken(next)
                setOpen(true)
            } catch {
                setSuggestions([])
            } finally {
                setSearching(false)
            }
        }, debounceMs)
    }

    const handleInputChange = (e) => {
        const next = e.target.value
        skipFetchRef.current = false
        onChange?.(next)
        setOpen(true)
        fetchSuggestions(next)
    }

    const resolveAndSelect = async (item) => {
        setResolving(true)
        try {
            let address = suggestionTitle(item)
            let lat
            let lng

            if (typeof item === 'string') {
                address = item
            } else if (item?.lat != null && item?.lng != null) {
                address = suggestionTitle(item)
                    + (suggestionSubtitle(item) ? ` - ${suggestionSubtitle(item)}` : '')
                lat = item.lat
                lng = item.lng
            } else if (item?.placeId) {
                const details = await getPlaceDetails(item.placeId, sessionToken)
                address = details.address || suggestionTitle(item)
                lat = details.ltd
                lng = details.lng
                setSessionToken(null)
            } else {
                address = suggestionTitle(item)
                    + (suggestionSubtitle(item) ? ` - ${suggestionSubtitle(item)}` : '')
            }

            const formatted = formatAddressWithCoords({ address, lat, lng })
            skipFetchRef.current = true
            onChange?.(formatted)
            onResolved?.(formatted)
            setSuggestions([])
            setOpen(false)
        } catch (err) {
            console.error('Falha ao resolver endereço:', err)
            const fallback = suggestionTitle(item)
            if (fallback) {
                skipFetchRef.current = true
                onChange?.(fallback)
                onResolved?.(fallback)
                setSuggestions([])
                setOpen(false)
            }
        } finally {
            setResolving(false)
        }
    }

    const showList = open && (searching || resolving || suggestions.length > 0)

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            {label && (
                <label htmlFor={id} className="block text-sm font-medium text-ink-600 mb-1.5">
                    {label}
                </label>
            )}
            <div className="relative">
                {icon && (
                    <i
                        className={`${icon} absolute left-3.5 top-1/2 -translate-y-1/2 ${iconClassName}`}
                        aria-hidden="true"
                    />
                )}
                <input
                    id={id}
                    type="text"
                    className={inputClassName}
                    placeholder={placeholder}
                    value={value}
                    disabled={disabled || resolving}
                    onChange={handleInputChange}
                    onFocus={() => {
                        if (suggestions.length > 0) setOpen(true)
                        else if (String(value).trim().length >= minChars && !skipFetchRef.current) {
                            fetchSuggestions(value)
                        }
                    }}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showList}
                    aria-controls={id ? `${id}-listbox` : undefined}
                    aria-autocomplete="list"
                />
                {(searching || resolving) && (
                    <i
                        className="ri-loader-4-line animate-spin absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-500"
                        aria-hidden="true"
                    />
                )}
            </div>

            {showList && (
                <ul
                    id={id ? `${id}-listbox` : undefined}
                    role="listbox"
                    className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-surface border border-line rounded-panel shadow-floating divide-y divide-line"
                >
                    {searching && suggestions.length === 0 && (
                        <li className="px-3 py-3 text-sm text-ink-400">Buscando sugestões…</li>
                    )}
                    {!searching && !resolving && suggestions.length === 0 && (
                        <li className="px-3 py-3 text-sm text-ink-400">Nenhuma sugestão encontrada</li>
                    )}
                    {suggestions.map((item, idx) => {
                        const title = suggestionTitle(item)
                        const subtitle = suggestionSubtitle(item)
                        return (
                            <li key={`${title}-${idx}`} role="option">
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-2.5 flex gap-3 items-start hover:bg-surface-alt active:bg-brand-50"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => resolveAndSelect(item)}
                                >
                                    <i className="ri-map-pin-fill text-brand-500 mt-0.5" aria-hidden="true" />
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold text-ink-900 truncate">{title}</span>
                                        {subtitle && (
                                            <span className="block text-xs text-ink-500 truncate">{subtitle}</span>
                                        )}
                                    </span>
                                </button>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
