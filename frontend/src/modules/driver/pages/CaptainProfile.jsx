import React, { useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaptainDataContext } from '@/contexts/CaptainContext';
import CaptainHeader from '@/modules/driver/components/CaptainHeader';
import Avatar from '@/shared/components/Avatar';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import StatusBadge from '@/shared/components/ui/StatusBadge';

// Auditoria de UX do motorista (2026-08-02, §2.7): a tela antiga só sabia comparar
// approvalStatus com 'approved' (inglês) — nunca batia com o enum real, em português,
// de 7 estados. Todo motorista via "Pendente" pra sempre, aprovado ou não.
const APPROVAL_LABELS = {
    iniciado: { tone: 'neutral', label: 'Cadastro incompleto', icon: 'ri-file-list-3-line' },
    documentos_enviados: { tone: 'info', label: 'Documentos enviados', icon: 'ri-upload-cloud-2-line' },
    em_analise: { tone: 'warning', label: 'Em análise', icon: 'ri-time-fill' },
    aprovado: { tone: 'success', label: 'Aprovado', icon: 'ri-checkbox-circle-fill' },
    reprovado: { tone: 'danger', label: 'Reprovado', icon: 'ri-close-circle-fill' },
    suspenso: { tone: 'warning', label: 'Suspenso', icon: 'ri-pause-circle-fill' },
    bloqueado: { tone: 'danger', label: 'Bloqueado', icon: 'ri-forbid-fill' },
}

const DOCUMENT_LABELS = {
    cnhFront: 'CNH (frente)',
    cnhBack: 'CNH (verso)',
    crlv: 'CRLV',
    vehicleFront: 'Foto do veículo',
    selfie: 'Selfie com a CNH',
}

const CaptainProfile = () => {
    const { captain } = useContext(CaptainDataContext);
    const navigate = useNavigate();
    const approval = APPROVAL_LABELS[captain?.approvalStatus] || APPROVAL_LABELS.em_analise;
    const documents = captain?.documents || {};

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader
                title="Perfil"
                className="shadow-raised"
                rightSlot={
                    <button onClick={() => navigate('/captain/logout')} className="text-danger-500 font-semibold p-2 bg-danger-50 rounded-panel">
                        Sair
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                <Card shadow="raised" padding="p-6" className="mb-6 flex flex-col items-center">
                    <Avatar
                        firstname={captain?.fullname?.firstname}
                        lastname={captain?.fullname?.lastname}
                        size="w-24 h-24"
                        className="border-4 border-yellow-400 mb-4 text-3xl"
                    />
                    <h2 className="text-xl font-bold capitalize text-ink-900">
                        {captain?.fullname?.firstname} {captain?.fullname?.lastname}
                    </h2>
                    <p className="text-ink-600">{captain?.email}</p>
                    <div className="mt-4">
                        <StatusBadge tone="success">Motorista Parceiro</StatusBadge>
                    </div>
                </Card>

                <Card shadow="raised" padding="p-5" className="mb-6">
                    <h3 className="font-semibold text-ink-900 mb-4">Informações do Veículo</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between border-b border-line pb-2">
                            <span className="text-ink-600">Tipo</span>
                            <span className="font-medium text-ink-900 capitalize">{captain?.vehicle?.vehicleType}</span>
                        </div>
                        <div className="flex justify-between border-b border-line pb-2">
                            <span className="text-ink-600">Cor</span>
                            <span className="font-medium text-ink-900 capitalize">{captain?.vehicle?.color}</span>
                        </div>
                        <div className="flex justify-between border-b border-line pb-2">
                            <span className="text-ink-600">Placa</span>
                            <span className="font-medium text-ink-900 uppercase">{captain?.vehicle?.plate}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-ink-600">Capacidade</span>
                            <span className="font-medium text-ink-900">{captain?.vehicle?.capacity} pessoas</span>
                        </div>
                    </div>
                </Card>

                <Card shadow="raised" padding="p-5" className="mb-6">
                    <h3 className="font-semibold text-ink-900 mb-4">Status da Conta</h3>
                    <div className="flex justify-between items-center">
                        <span className="text-ink-600">Aprovação</span>
                        <StatusBadge tone={approval.tone}>
                            <i className={`${approval.icon} mr-1`}></i> {approval.label}
                        </StatusBadge>
                    </div>
                    {captain?.isBlocked && (
                        <div className="flex justify-between items-center mt-3 pt-3 border-t border-line">
                            <span className="text-ink-600">Acesso</span>
                            <StatusBadge tone="danger">
                                <i className="ri-forbid-fill mr-1"></i> Bloqueado
                            </StatusBadge>
                        </div>
                    )}
                </Card>

                <Card shadow="raised" padding="p-5">
                    <h3 className="font-semibold text-ink-900 mb-4">Documentos</h3>
                    <div className="space-y-3">
                        {Object.entries(DOCUMENT_LABELS).map(([key, label]) => {
                            const doc = documents[key];
                            const sent = !!doc?.url;
                            const verified = !!doc?.verified;
                            return (
                                <div key={key} className="flex justify-between items-center">
                                    <span className="text-ink-600">{label}</span>
                                    {verified ? (
                                        <StatusBadge tone="success">
                                            <i className="ri-checkbox-circle-fill mr-1"></i> Verificado
                                        </StatusBadge>
                                    ) : sent ? (
                                        <StatusBadge tone="info">
                                            <i className="ri-time-line mr-1"></i> Em análise
                                        </StatusBadge>
                                    ) : (
                                        <StatusBadge tone="neutral">
                                            <i className="ri-close-line mr-1"></i> Não enviado
                                        </StatusBadge>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </Card>
            </div>

            <CaptainHeader />
        </div>
    );
};

export default CaptainProfile;
