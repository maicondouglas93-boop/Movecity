import React from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api';
import { X, Activity, User, Car, Package, CreditCard, Flag, Shield, Navigation, History as HistoryIcon, ShieldCheck, RefreshCw } from 'lucide-react';
import { timeAgo, itemStatusLabel, itemStatusColor, canFinalizeRide, canRelaunchManualRide, currentLegTarget, googleMapsUrl, RIDE_LOG_ACTION_LABELS } from './rideUi';
import { RIDE_STATUS_LABELS, PARCEL_STATUS_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS, statusLabel } from '../../utils/statusDictionary';
import StatusBadge from '../StatusBadge';
import { formatMoney, formatDateTime } from '../../utils/format';

// Auditoria de UX (2026-08-10): reescrito nos 9 blocos pedidos (RESUMO / CLIENTE /
// MOTORISTA / ROTA / VALORES / PAGAMENTO / STATUS / HISTÓRICO / AUDITORIA). A timeline
// deixou de ser simulada (comentário antigo: "Fake timeline events for visual demo")
// e passou a usar ride.statusHistory real (preenchido em transitionRide desde
// 2026-08-10 — corridas/encomendas anteriores a essa mudança não têm o array).
export default function RideDrawer({ ride, onClose, onAction }) {
  const isParcel = ride?.serviceType === 'parcel';

  const { data: auditLog } = useQuery({
    queryKey: ['ride-timeline', ride?._id],
    queryFn: async () => {
      const { data } = await api.get(`/admin/rides/${ride._id}/timeline`);
      return data;
    },
    // Endpoint de auditoria cobre só corrida por enquanto — cancelamento de encomenda
    // já gera log (targetModel 'Parcel'), mas sem endpoint de leitura dedicado ainda.
    enabled: !!ride?._id && !isParcel,
  });

  const {
    data: accessCode,
    error: accessCodeError,
    isFetching: isFetchingAccessCode,
    refetch: revealAccessCode,
  } = useQuery({
    queryKey: ['manual-ride-access-code', ride?._id],
    queryFn: async () => {
      const { data } = await api.get(`/admin/rides/${ride._id}/access-code`);
      return data;
    },
    enabled: false,
    retry: false,
  });

  if (!ride) return null;

  const af = ride.adminFinalization;
  const mapsTarget = currentLegTarget(ride);
  const mapsUrl = googleMapsUrl(mapsTarget);
  const statusDict = isParcel ? PARCEL_STATUS_LABELS : RIDE_STATUS_LABELS;
  const history = Array.isArray(ride.statusHistory) ? ride.statusHistory : [];

  // Fora da árvore do MapContainer (React 19 + Leaflet → insertBefore/removeChild).
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/50 z-[4000]" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-surface border-l border-border shadow-2xl z-[4001] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-background/50">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              {isParcel ? <Package className="w-4 h-4 text-purple-500" /> : <Car className="w-4 h-4 text-text-muted" />}
              Ficha {isParcel ? 'da encomenda' : 'da corrida'}
            </h2>
            <p className="text-xs text-text-muted">ID: {ride._id}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">

          {/* ===== RESUMO ===== */}
          <div className={`p-4 border rounded-xl flex items-start gap-3 ${itemStatusColor(ride)}`}>
            <Activity className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm uppercase">{itemStatusLabel(ride)}</p>
              <p className="text-xs mt-1 opacity-80">Atualizado {timeAgo(ride.updatedAt)}</p>
              {ride.status === 'cancelled' && (ride.cancellationReason || ride.observation) && (
                <div className="mt-2 p-2 bg-black/20 rounded border border-white/10 text-xs">
                  <strong>Motivo:</strong> {ride.cancellationReason || ride.observation}
                </div>
              )}
            </div>
          </div>

          {/* Ações rápidas */}
          {(canFinalizeRide(ride) || !['cancelled', 'finished'].includes(ride.status) || mapsUrl) && (
            <div className="flex flex-wrap gap-2">
              {mapsUrl && (
                <a
                  href={mapsUrl} target="_blank" rel="noopener noreferrer"
                  className="flex-1 min-w-[140px] py-2 bg-info/10 text-info text-sm font-medium rounded-lg border border-info/20 hover:bg-info/20 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <Navigation className="w-4 h-4" /> {mapsTarget?.pickupLeg ? 'Mapa até a retirada' : 'Mapa até o destino'}
                </a>
              )}
              {canFinalizeRide(ride) && (
                <button
                  onClick={() => { onClose(); onAction(ride, 'finalize'); }}
                  className="flex-1 min-w-[140px] py-2 bg-primary/10 text-primary text-sm font-medium rounded-lg border border-primary/20 hover:bg-primary/20 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <Flag className="w-4 h-4" /> Finalizar manualmente
                </button>
              )}
              {!['cancelled', 'finished'].includes(ride.status) && (
                <button onClick={() => { onClose(); onAction(ride, 'cancel'); }} className="flex-1 min-w-[120px] py-2 bg-danger/10 text-danger text-sm font-medium rounded-lg border border-danger/20 hover:bg-danger/20 transition-colors">
                  {isParcel ? 'Cancelar encomenda' : 'Cancelar corrida'}
                </button>
              )}
              {ride.status === 'requested' && !isParcel && (
                <button onClick={() => { onClose(); onAction(ride, 'reassign'); }} className="flex-1 min-w-[120px] py-2 bg-warning/10 text-warning text-sm font-medium rounded-lg border border-warning/20 hover:bg-warning/20 transition-colors">
                  Reatribuir
                </button>
              )}
              {canRelaunchManualRide(ride) && (
                <button onClick={() => { onClose(); onAction(ride, 'relaunch'); }} className="flex-1 min-w-[150px] py-2 bg-primary/10 text-primary text-sm font-medium rounded-lg border border-primary/20 hover:bg-primary/20 transition-colors inline-flex items-center justify-center gap-1.5">
                  <RefreshCw className="w-4 h-4" /> Lançar novamente
                </button>
              )}
            </div>
          )}

          {af && (
            <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Shield className="w-4 h-4" />
                <h3 className="text-sm font-semibold uppercase tracking-wider">Finalização administrativa</h3>
              </div>
              <div className="grid grid-cols-1 gap-1.5 text-sm">
                <p><span className="text-text-muted">Admin:</span> {af.adminName || '—'}</p>
                <p><span className="text-text-muted">Quando:</span> {af.finalizedAt ? formatDateTime(af.finalizedAt) : '—'}</p>
                <p><span className="text-text-muted">Motivo:</span> {af.reason || '—'}</p>
                {af.observation ? (
                  <p><span className="text-text-muted">Observação:</span> {af.observation}</p>
                ) : null}
                {Number.isFinite(Number(af.finalPrice)) && (
                  <p><span className="text-text-muted">Valor final:</span> {formatMoney(af.finalPrice)}</p>
                )}
                {Number.isFinite(Number(af.finishLocation?.lat)) && Number.isFinite(Number(af.finishLocation?.lng)) && (
                  <p className="text-xs text-text-muted">
                    GPS: {Number(af.finishLocation.lat).toFixed(5)}, {Number(af.finishLocation.lng).toFixed(5)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ===== CLIENTE ===== */}
          <Section title="Cliente">
            <PersonCard
              icon={<User className="w-4 h-4 text-text-muted" />}
              name={`${ride.user?.fullname?.firstname || ''} ${ride.user?.fullname?.lastname || ''}`.trim() || ride.adminPassenger?.name || (isParcel ? 'Remetente' : 'Passageiro')}
              sub={ride.user?.phone || ride.adminPassenger?.phone}
            />
            {ride.adminPassenger?.passengerCount ? (
              <p className="text-xs text-text-muted mt-2">
                {ride.adminPassenger.passengerCount} passageiro(s)
                {ride.adminPassenger.note ? ` · ${ride.adminPassenger.note}` : ''}
              </p>
            ) : null}
            {ride.source === 'admin' && !['finished', 'cancelled'].includes(ride.status) ? (
              <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                {accessCode?.otp ? (
                  <div>
                    <p className="text-xs text-text-muted">PIN para iniciar a corrida</p>
                    <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-primary">{accessCode.otp}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => revealAccessCode()}
                    disabled={isFetchingAccessCode}
                    className="text-sm font-medium text-primary hover:underline disabled:cursor-wait disabled:opacity-60"
                  >
                    {isFetchingAccessCode ? 'Buscando PIN…' : 'Exibir PIN de início'}
                  </button>
                )}
                {accessCodeError ? (
                  <p className="mt-2 text-xs text-danger">
                    {accessCodeError.response?.data?.message || 'Não foi possível recuperar o PIN.'}
                  </p>
                ) : null}
              </div>
            ) : null}
            {isParcel && ride.sender && (ride.sender.name || ride.sender.phone) && (
              <p className="text-xs text-text-muted mt-2">Remetente informado na encomenda: {ride.sender.name} {ride.sender.phone ? `· ${ride.sender.phone}` : ''}</p>
            )}
            {isParcel && ride.recipient && (
              <p className="text-xs text-text-muted mt-1">Destinatário: {ride.recipient.name} {ride.recipient.phone ? `· ${ride.recipient.phone}` : ''}</p>
            )}
          </Section>

          {/* ===== MOTORISTA ===== */}
          <Section title="Motorista">
            {ride.captain ? (
              <PersonCard icon={<Car className="w-4 h-4 text-text-muted" />} name={`${ride.captain.fullname?.firstname || ''} ${ride.captain.fullname?.lastname || ''}`.trim()} sub={ride.captain.vehicle?.plate} />
            ) : (
              <p className="text-sm text-text-muted italic py-1">Nenhum atribuído</p>
            )}
          </Section>

          {/* ===== ROTA ===== */}
          <Section title="Rota">
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-2.75 top-2 bottom-2 w-0.5 bg-border"></div>
              <div className="relative">
                <div className="absolute -left-7.5 top-1 w-3 h-3 rounded-full bg-primary ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.pickup}</p>
                <p className="text-xs text-text-muted">Origem</p>
              </div>
              <div className="relative">
                <div className="absolute -left-7.5 top-1 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-background"></div>
                <p className="text-sm font-medium">{ride.destination}</p>
                <p className="text-xs text-text-muted">Destino</p>
              </div>
            </div>
            {isParcel && (
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-text-muted">Item</p><p className="font-medium">{ride.itemName || '—'}</p></div>
                <div><p className="text-xs text-text-muted">Categoria</p><p className="font-medium capitalize">{ride.category || '—'}</p></div>
                <div><p className="text-xs text-text-muted">Peso</p><p className="font-medium">{ride.weightKg != null ? `${ride.weightKg} kg` : '—'}</p></div>
                <div><p className="text-xs text-text-muted">Tamanho</p><p className="font-medium capitalize">{ride.size || '—'}</p></div>
              </div>
            )}
          </Section>

          {/* ===== VALORES ===== */}
          <Section title="Valores">
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Valor estimado</span>
              <span className="font-medium text-text">{formatMoney(ride.fare)}</span>
            </div>
            {Number.isFinite(ride.finalPrice) && ride.finalPrice !== ride.fare && (
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Valor final</span>
                <span className="font-medium text-primary">{formatMoney(ride.finalPrice)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Comissão da plataforma</span>
              <span className="font-medium text-primary">{ride.commissionAmount ? formatMoney(ride.commissionAmount) : '—'}</span>
            </div>
          </Section>

          {/* ===== PAGAMENTO ===== */}
          <Section title="Pagamento">
            <div className="flex justify-between text-sm items-center">
              <span className="text-text-muted flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Método</span>
              <span className="font-medium text-text">{PAYMENT_METHOD_LABELS[ride.paymentMethod] || ride.paymentMethod}</span>
            </div>
            {ride.paymentStatus && (
              <div className="flex justify-between text-sm items-center mt-2">
                <span className="text-text-muted">Status do pagamento</span>
                <StatusBadge colorClass={PAYMENT_STATUS_COLORS[ride.paymentStatus]} label={statusLabel(PAYMENT_STATUS_LABELS, ride.paymentStatus)} />
              </div>
            )}
          </Section>

          {/* ===== STATUS / HISTÓRICO ===== */}
          <Section title="Histórico de status" icon={<HistoryIcon className="w-4 h-4" />}>
            {history.length > 0 ? (
              <div className="space-y-4">
                {history.map((evt, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full mt-1 ${evt.status === 'cancelled' ? 'bg-danger' : 'bg-primary'}`}></div>
                      {idx < history.length - 1 && <div className="w-0.5 h-full my-1 bg-primary/50"></div>}
                    </div>
                    <div className="pb-4">
                      <p className={`text-sm font-medium ${evt.status === 'cancelled' ? 'text-danger' : 'text-text'}`}>{statusLabel(statusDict, evt.status)}</p>
                      <p className="text-xs text-text-muted">{formatDateTime(evt.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted italic">Sem histórico de transições registrado — {isParcel ? 'esta encomenda' : 'esta corrida'} é anterior a 10/08/2026, quando esse registro passou a existir.</p>
            )}
          </Section>

          {/* ===== AUDITORIA ===== */}
          {!isParcel && (
            <Section title="Auditoria administrativa" icon={<ShieldCheck className="w-4 h-4" />}>
              {auditLog && auditLog.length > 0 ? (
                <div className="space-y-3">
                  {auditLog.map((log) => (
                    <div key={log._id} className="p-3 bg-background rounded-lg border border-border/50 text-sm">
                      <p className="font-medium text-text">{RIDE_LOG_ACTION_LABELS[log.action] || log.action}</p>
                      <p className="text-xs text-text-muted mt-0.5">{log.adminName} · {formatDateTime(log.createdAt)}</p>
                      {log.reason && <p className="text-xs text-text-muted mt-1">Motivo: {log.reason}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted italic">Nenhuma ação administrativa registrada para esta corrida.</p>
              )}
            </Section>
          )}

        </div>
      </div>
    </>,
    document.body,
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="space-y-3 pt-4 border-t border-border first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-text-muted flex items-center gap-2">{icon}{title}</h3>
      {children}
    </div>
  );
}

function PersonCard({ icon, name, sub }) {
  return (
    <div className="bg-background p-3 rounded-xl border border-border flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0">{icon}</div>
      <div className="overflow-hidden">
        <p className="text-sm font-medium truncate">{name || '—'}</p>
        {sub && <p className="text-xs text-text-muted truncate">{sub}</p>}
      </div>
    </div>
  );
}
