import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  embedCoordinatesInValue = true,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessionToken, setSessionToken] = useState(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const requestIdRef = useRef(0);
  const rootRef = useRef(null);
  const skipFetchRef = useRef(false);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const onDocClick = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      // Lista em portal (fora do root) — não fechar ao clicar na sugestão.
      if (e.target.closest?.(`[data-admin-ac-list="${id || 'ac'}"]`)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [id]);

  const fetchSuggestions = (input) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const requestId = ++requestIdRef.current;
    const q = String(input || '').trim();
    if (q.length < minChars) {
      setSuggestions([]);
      setSearching(false);
      setHasSearched(false);
      setOpen(false);
      return;
    }
    setSearching(true);
    setHasSearched(false);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { suggestions: list, sessionToken: next } = await getAddressSuggestions({
          input: q,
          lat: biasLocation?.lat ?? biasLocation?.ltd,
          lng: biasLocation?.lng,
          sessionToken,
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current) return;
        setSuggestions(list.slice(0, 8));
        setActiveIndex(0);
        setHasSearched(true);
        if (next) setSessionToken(next);
        setOpen(true);
      } catch {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setHasSearched(true);
        setOpen(true);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, debounceMs);
  };

  const handleInputChange = (e) => {
    const next = e.target.value;
    skipFetchRef.current = false;
    onChange?.(next);
    setOpen(true);
    setActiveIndex(0);
    fetchSuggestions(next);
  };

  const resolveAndSelect = async (item) => {
    // Fecha a lista antes do async — evita removeChild quando o pai re-renderiza a rota.
    ++requestIdRef.current;
    abortRef.current?.abort();
    setOpen(false);
    setSuggestions([]);
    setHasSearched(false);
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

      const formatted = embedCoordinatesInValue
        ? formatAddressWithCoords({ address, lat, lng })
        : String(address || '').trim();
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

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      resolveAndSelect(suggestions[activeIndex]);
    }
  };

  const showList = open && (searching || resolving || suggestions.length > 0 || hasSearched);
  const [listStyle, setListStyle] = useState(null);

  useEffect(() => {
    if (!showList || !rootRef.current) {
      setListStyle(null);
      return undefined;
    }
    const update = () => {
      const input = rootRef.current?.querySelector('input');
      const rect = (input || rootRef.current).getBoundingClientRect();
      setListStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 5000,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showList, suggestions.length, searching, resolving]);

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
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
          else if (String(value).trim().length >= minChars && !skipFetchRef.current) {
            fetchSuggestions(value);
          }
        }}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-activedescendant={showList && suggestions[activeIndex] && id ? `${id}-option-${activeIndex}` : undefined}
      />
      {(searching || resolving) && (
        <span className="absolute right-3 top-8 text-[10px] text-text-muted">…</span>
      )}

      {showList && listStyle && createPortal(
        <ul
          id={id ? `${id}-listbox` : undefined}
          data-admin-ac-list={id || 'ac'}
          role="listbox"
          style={listStyle}
          className="max-h-56 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg divide-y divide-border"
        >
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
              <li key={item?.placeId || `${title}-${idx}`} id={id ? `${id}-option-${idx}` : undefined} role="option" aria-selected={idx === activeIndex}>
                <button
                  type="button"
                  className={`w-full text-left px-3 py-2 hover:bg-background transition-colors ${idx === activeIndex ? 'bg-background' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(idx)}
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
        </ul>,
        document.body,
      )}
    </div>
  );
}
