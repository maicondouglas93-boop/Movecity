import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CaptainDataContext } from '@/driver/contexts/CaptainContext';
import CaptainHeader from '@/driver/components/CaptainHeader';
import Avatar from '@/shared/components/Avatar';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import Button from '@/shared/components/ui/Button';
import { useToast } from '@/shared/contexts/ToastContext';
import { getAccessToken } from '@/shared/services/session';
import { getFriendlyErrorMessage } from '@/shared/services/errorMessages';

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
    // 'expirado' adicionado na simplificação do cadastro (2026-08-04).
    expirado: { tone: 'danger', label: 'Prazo expirado', icon: 'ri-time-line' },
}

const DOCUMENT_LABELS = {
    cnhFront: 'CNH (frente)',
    cnhBack: 'CNH (verso)',
    crlv: 'CRLV',
    vehicleFront: 'Foto do veículo',
    selfie: 'Selfie com a CNH',
}

// Simplificação do cadastro do motorista (2026-08-04): o prazo mostrado aqui vem
// SEMPRE de captain.documentDeadline (calculado pelo backend) — nunca um número fixo.
// O relógio do aparelho só decide o "hoje" da conta regressiva, nunca o prazo em si.
const formatDeadlineDate = (deadline) => {
    if (!deadline) return '';
    return new Date(deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const daysRemainingLabel = (days) => {
    if (days > 1) return `Você tem ${days} dias para enviar seus documentos.`;
    if (days === 1) return 'Você tem 1 dia para enviar seus documentos.';
    if (days === 0) return 'Seu prazo termina hoje.';
    return 'O prazo para envio da documentação expirou.';
}

// Card de documentação pendente/em análise/aprovado/rejeitado/expirado — ver §6, §7, §8
// e §11 da simplificação do cadastro. 'suspenso'/'bloqueado' não entram aqui: são ações
// administrativas sem relação com o prazo de documentação, já cobertas pelo card
// "Status da Conta" abaixo.
const DocumentationCard = ({ captain }) => {
    const navigate = useNavigate();
    const status = captain?.approvalStatus;
    const deadline = captain?.documentDeadline;
    const daysRemaining = deadline != null
        ? Math.ceil((new Date(deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

    if (status === 'expirado') {
        return (
            <Card shadow="raised" padding="p-5" className="mb-6 border-danger-500/30 bg-danger-50">
                <div className="flex items-start gap-3">
                    <i className="ri-error-warning-fill text-2xl text-danger-500 flex-shrink-0"></i>
                    <div className="flex-1">
                        <h3 className="font-bold text-danger-700">Prazo expirado</h3>
                        <p className="text-sm text-danger-600 mt-1">O prazo para envio da documentação expirou. Envie agora para reativar sua conta.</p>
                        <Button onClick={() => navigate('/captain/documents')} variant="dangerSolid" className="mt-3">
                            Enviar documentos
                        </Button>
                    </div>
                </div>
            </Card>
        );
    }

    if (status === 'reprovado') {
        return (
            <Card shadow="raised" padding="p-5" className="mb-6 border-danger-500/30 bg-danger-50">
                <div className="flex items-start gap-3">
                    <i className="ri-close-circle-fill text-2xl text-danger-500 flex-shrink-0"></i>
                    <div className="flex-1">
                        <h3 className="font-bold text-danger-700">Documentação reprovada</h3>
                        <p className="text-sm text-danger-600 mt-1">Alguns documentos foram rejeitados. Verifique o motivo e envie novamente.</p>
                        <Button onClick={() => navigate('/captain/documents')} variant="dangerSolid" className="mt-3">
                            Ver documentos
                        </Button>
                    </div>
                </div>
            </Card>
        );
    }

    if (status === 'iniciado') {
        return (
            <Card shadow="raised" padding="p-5" className="mb-6 border-warning-500/30 bg-amber-50">
                <div className="flex items-start gap-3">
                    <i className="ri-alert-fill text-2xl text-amber-500 flex-shrink-0"></i>
                    <div className="flex-1">
                        <h3 className="font-bold text-amber-800">Documentação pendente</h3>
                        <p className="text-sm text-amber-700 mt-1">
                            {deadline ? `Você tem até ${formatDeadlineDate(deadline)} para enviar seus documentos.` : 'Envie seus documentos para concluir a ativação da sua conta.'}
                        </p>
                        {daysRemaining != null && (
                            <p className="text-xs text-amber-700 font-semibold mt-1">{daysRemainingLabel(daysRemaining)}</p>
                        )}
                        <Button onClick={() => navigate('/captain/documents')} className="mt-3">
                            Enviar documentos
                        </Button>
                    </div>
                </div>
            </Card>
        );
    }

    if (status === 'documentos_enviados' || status === 'em_analise') {
        return (
            <Card shadow="raised" padding="p-5" className="mb-6 border-blue-500/30 bg-blue-50">
                <div className="flex items-start gap-3">
                    <i className="ri-checkbox-circle-fill text-2xl text-blue-500 flex-shrink-0"></i>
                    <div className="flex-1">
                        <h3 className="font-bold text-blue-800">Documentos enviados</h3>
                        <p className="text-sm text-blue-700 mt-1">Seus documentos foram enviados e estão em análise.</p>
                        <button type="button" onClick={() => navigate('/captain/documents')} className="text-sm font-semibold text-blue-700 underline mt-2">
                            Ver documentos
                        </button>
                    </div>
                </div>
            </Card>
        );
    }

    if (status === 'aprovado') {
        return (
            <Card shadow="raised" padding="p-5" className="mb-6 border-brand-500/30 bg-brand-50">
                <div className="flex items-start gap-3">
                    <i className="ri-shield-check-fill text-2xl text-brand-600 flex-shrink-0"></i>
                    <div className="flex-1">
                        <h3 className="font-bold text-brand-800">Documentação aprovada</h3>
                        <button type="button" onClick={() => navigate('/captain/documents')} className="text-sm font-semibold text-brand-700 underline mt-1">
                            Ver documentos
                        </button>
                    </div>
                </div>
            </Card>
        );
    }

    return null;
}

const CaptainProfile = () => {
    const { captain, setCaptain } = useContext(CaptainDataContext);
    const navigate = useNavigate();
    const { addToast } = useToast();
    const [photoUploading, setPhotoUploading] = useState(false);
    const approval = APPROVAL_LABELS[captain?.approvalStatus] || APPROVAL_LABELS.em_analise;
    const documents = captain?.documents || {};

    const handlePhotoChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            addToast('Selecione uma imagem válida.', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            addToast('A foto deve ter no máximo 5 MB.', 'error');
            return;
        }

        setPhotoUploading(true);
        try {
            const formData = new FormData();
            formData.append('image', file);
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URL}/uploads/captain-profile`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${getAccessToken('captain')}`,
                        'Content-Type': 'multipart/form-data',
                    },
                }
            );
            if (response.data?.captain) setCaptain(response.data.captain);
            addToast('Foto de perfil atualizada!', 'success');
        } catch (error) {
            addToast(
                getFriendlyErrorMessage(error, 'Não foi possível enviar a foto. Tente novamente.'),
                'error'
            );
        } finally {
            setPhotoUploading(false);
            e.target.value = '';
        }
    };

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader
                title="Perfil"
                className="shadow-raised"
                rightSlot={
                    <button type="button" onClick={() => navigate('/captain/logout')} className="text-danger-500 font-semibold p-2 bg-danger-50 rounded-panel">
                        Sair
                    </button>
                }
            />

            <div className="flex-1 overflow-y-auto p-4 pb-6">
                <Card shadow="raised" padding="p-6" className="mb-6 flex flex-col items-center">
                    <div className="relative mb-4">
                        <Avatar
                            firstname={captain?.fullname?.firstname}
                            lastname={captain?.fullname?.lastname}
                            src={captain?.profilePicture}
                            size="w-24 h-24"
                            className="border-4 border-yellow-400 text-3xl"
                        />
                        <label
                            htmlFor="captain-profile-photo"
                            className="absolute bottom-0 right-0 bg-ink-900 text-white rounded-full h-9 w-9 flex items-center justify-center shadow-raised cursor-pointer active:scale-95 transition-transform border-2 border-surface"
                        >
                            <i className={`text-base ${photoUploading ? 'ri-loader-4-line animate-spin' : 'ri-camera-fill'}`} aria-hidden="true" />
                        </label>
                        <input
                            id="captain-profile-photo"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePhotoChange}
                            disabled={photoUploading}
                        />
                    </div>
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

                <DocumentationCard captain={captain} />

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
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-ink-900">Documentos</h3>
                        <button type="button" onClick={() => navigate('/captain/documents')} className="text-sm font-semibold text-brand-600">
                            Gerenciar
                        </button>
                    </div>
                    <div className="space-y-3">
                        {Object.entries(DOCUMENT_LABELS).map(([key, label]) => {
                            const doc = documents[key];
                            const sent = !!doc?.url;
                            const verified = !!doc?.verified;
                            const rejected = sent && !verified && !!doc?.reason;
                            return (
                                <div key={key}>
                                    <div className="flex justify-between items-center">
                                        <span className="text-ink-600">{label}</span>
                                        {verified ? (
                                            <StatusBadge tone="success">
                                                <i className="ri-checkbox-circle-fill mr-1"></i> Verificado
                                            </StatusBadge>
                                        ) : rejected ? (
                                            <StatusBadge tone="danger">
                                                <i className="ri-close-circle-fill mr-1"></i> Rejeitado
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
                                    {rejected && (
                                        <p className="text-xs text-danger-600 mt-1">{doc.reason}</p>
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
