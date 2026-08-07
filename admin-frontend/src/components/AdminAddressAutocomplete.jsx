import React, { useEffect, useRef, useState } from 'react';
import {
  formatAddressWithCoords,
  getAddressSuggestions,
  getPlaceDetails,
  suggestionSubtitle,
  suggestionTitle,
} from '../services/mapsApi';

/**
 * Autocomplete de endereço para o admin (proxy /admin/maps/*).
 */
export default function AdminAddressAutocomplete({
  id,
  label,
  value = '',
  onChange,
  onResolved,
  placeholder = 'Digite o endereço',
  biasLocation = null,
  disabled = false,
  minChars = 3,
  debounceMs = 400,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const debounceRef = useRef(null);
  const rootRef = useRef(null);
  const skipFetchRef = useRef(false);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const fetchSuggestions = (input) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = String(input || '').trim();
    if (q.length < minChars) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const { suggestions: list, sessionToken: next } = await getAddressSuggestions({
          input: q,
          lat: biasLocation?.lat ?? biasLocation?.ltd,
          lng: biasLocation?.lng,
          sessionToken,
        });
        setSuggestions(list.slice(0, 8));
        if (next) setSessionToken(next);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, debounceMs);
  };

  const handleInputChange = (e) => {
    const next = e.target.value;
    skipFetchRef.current = false;
    onChange?.(next);
    setOpen(true);
    fetchSuggestions(next);
  };

  const resolveAndSelect = async (item) => {
    setResolving(true);
    try {
      let address = suggestionTitle(item);
      let lat;
      let lng;

      if (typeof item === 'string') {
        address = item;
      } else if (item?.lat != null && item?.lng != null) {
        address = suggestionTitle(item)
          + (suggestionSubtitle(item) ? ` - ${suggestionSubtitle(item)}` : '');
        lat = item.lat;
        lng = item.lng;
      } else if (item?.placeId) {
        const details = await getPlaceDetails(item.placeId, sessionToken);
        address = details.address || suggestionTitle(item);
        lat = details.ltd;
        lng = details.lng;
        setSessionToken(null);
      } else {
        address = suggestionTitle(item)
          + (suggestionSubtitle(item) ? ` - ${suggestionSubtitle(item)}` : '');
      }

      const formatted = formatAddressWithCoords({ address, lat, lng });
      skipFetchRef.current = true;
      onChange?.(formatted);
      onResolved?.(formatted, lat != null ? { lat: Number(lat), lng: Number(lng) } : null);
      setSuggestions([]);
      setOpen(false);
    } catch {
      const fallback = suggestionTitle(item);
      if (fallback) {
        skipFetchRef.current = true;
        onChange?.(fallback);
        onResolved?.(fallback, null);
        setSuggestions([]);
        setOpen(false);
      }
    } finally {
      setResolving(false);
    }
  };

  const showList = open && (searching || resolving || suggestions.length > 0);

  return (
    <div ref={rootRef} className="relative">
      {label && (
        <label htmlFor={id} className="block text-xs font-medium text-text-muted mb-1">
          {label}
        </label>
      )}
      <input
        id={id}
        type="text"
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-text focus:border-primary outline-none disabled:opacity-60"
        placeholder={placeholder}
        value={value}
        disabled={disabled || resolving}
        onChange={handleInputChange}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
          else if (String(value).trim().length >= minChars && !skipFetchRef.current) {
            fetchSuggestions(value);
          }
        }}
        autoComplete="off"
      />
      {(searching || resolving) && (
        <span className="absolute right-3 top-8 text-[10px] text-text-muted">…</span>
      )}

      {showList && (
        <ul className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg divide-y divide-border">
          {searching && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-text-muted">Buscando sugestões…</li>
          )}
          {!searching && !resolving && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-text-muted">Nenhuma sugestão encontrada</li>
          )}
          {suggestions.map((item, idx) => {
            const title = suggestionTitle(item);
            const subtitle = suggestionSubtitle(item);
            return (
              <li key={`${title}-${idx}`}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-background transition-colors"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => resolveAndSelect(item)}
                >
                  <span className="block text-sm font-medium text-text truncate">{title}</span>
                  {subtitle && (
                    <span className="block text-xs text-text-muted truncate">{subtitle}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
