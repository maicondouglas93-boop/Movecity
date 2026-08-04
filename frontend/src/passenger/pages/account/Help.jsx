import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import DetailRow from '@/shared/components/ui/DetailRow';
import Button from '@/shared/components/ui/Button';
import EmptyState from '@/shared/components/ui/EmptyState';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import { useToast } from '@/shared/contexts/ToastContext';
import { getAccessToken } from '@/shared/services/session';
import { getFriendlyErrorMessage } from '@/shared/services/errorMessages';

const FAQ_TOPICS = [
    {
        id: 'ride_issue',
        category: 'ride_issue',
        icon: 'ri-alert-fill',
        iconColor: 'text-amber-500',
        title: 'Problemas com uma corrida',
        subtitle: 'Valores incorretos, rota ruim, acidentes.',
        body: [
            'Se o valor final ficou diferente do estimado, confira o histórico da viagem: o preço pode variar pela distância e tempo reais percorridos.',
            'Em caso de rota estranha ou atraso relevante, abra um chamado com a data/hora e os endereços da corrida — nossa equipe analisa o caso.',
            'Se houve acidente ou situação de risco, priorize a emergência local (190/193) e depois registre o chamado no app com o máximo de detalhes.',
        ],
    },
    {
        id: 'lost_item',
        category: 'lost_item',
        icon: 'ri-search-eye-fill',
        iconColor: 'text-blue-500',
        title: 'Objeto perdido',
        subtitle: 'Esqueci algo no carro do motorista.',
        body: [
            'Abra um chamado na categoria “Objeto perdido” informando o dia, horário aproximado, origem/destino e a descrição do item.',
            'Se a corrida ainda estiver recente, você também pode tentar falar com o motorista pelo chat daquela viagem (quando disponível).',
            'Nossa equipe encaminha o pedido ao motorista. A devolução depende da disponibilidade dele e pode ter custo de deslocamento combinado entre as partes.',
        ],
    },
    {
        id: 'payment',
        category: 'payment',
        icon: 'ri-bank-card-fill',
        iconColor: 'text-brand-500',
        title: 'Problemas no pagamento',
        subtitle: 'Cobrança duplicada, cartão recusado.',
        body: [
            'Pix e dinheiro são acertados diretamente com o motorista. Se houver divergência no valor, abra um chamado com o comprovante quando houver.',
            'Pagamentos pela carteira MoveCity aparecem no extrato da carteira. Em cobrança duplicada, envie o horário e o valor no chamado.',
            'Cartão recusado costuma ser limite do banco ou dados desatualizados — tente outro método ou fale com o suporte do seu banco.',
        ],
    },
];

const STATUS_LABEL = {
    open: { text: 'Aberto', tone: 'warning' },
    in_progress: { text: 'Em andamento', tone: 'info' },
    resolved: { text: 'Resolvido', tone: 'success' },
    closed: { text: 'Fechado', tone: 'neutral' },
};

const Help = () => {
    const navigate = useNavigate();
    const { addToast } = useToast();

    const [ view, setView ] = useState('home'); // home | topic | newTicket | history
    const [ topic, setTopic ] = useState(null);
    const [ contact, setContact ] = useState({ whatsappUrl: null, email: null });
    const [ tickets, setTickets ] = useState([]);
    const [ loadingTickets, setLoadingTickets ] = useState(false);
    const [ submitting, setSubmitting ] = useState(false);
    const [ form, setForm ] = useState({
        category: 'other',
        message: '',
    });

    useEffect(() => {
        let cancelled = false;
        axios.get(`${import.meta.env.VITE_BASE_URL}/support/contact`)
            .then((res) => {
                if (cancelled) return;
                setContact({
                    whatsappUrl: res.data?.whatsappUrl || null,
                    email: res.data?.email || null,
                });
            })
            .catch(() => {
                // Fallback opcional via Vite (útil em dev sem backend configurado).
                const wa = String(import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '');
                const email = String(import.meta.env.VITE_SUPPORT_EMAIL || '').trim();
                if (!cancelled) {
                    setContact({
                        whatsappUrl: wa ? `https://wa.me/${wa}` : null,
                        email: email || null,
                    });
                }
            });
        return () => { cancelled = true };
    }, []);

    const openTopic = (item) => {
        setTopic(item);
        setView('topic');
    };

    const openNewTicket = (category = 'other') => {
        setForm({ category, message: '' });
        setView('newTicket');
    };

    const openWhatsApp = () => {
        if (!contact.whatsappUrl) {
            addToast('Canal de WhatsApp ainda não configurado. Use e-mail ou abra um chamado.', 'info');
            return;
        }
        window.open(contact.whatsappUrl, '_blank', 'noopener,noreferrer');
    };

    const openEmail = () => {
        if (!contact.email) {
            addToast('E-mail de suporte ainda não configurado. Abra um chamado pelo app.', 'info');
            return;
        }
        window.location.href = `mailto:${contact.email}?subject=${encodeURIComponent('Suporte MoveCity')}`;
    };

    const loadTickets = async () => {
        setLoadingTickets(true);
        setView('history');
        try {
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/support/tickets`, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` },
            });
            setTickets(Array.isArray(res.data?.tickets) ? res.data.tickets : []);
        } catch (err) {
            addToast(getFriendlyErrorMessage(err, 'Não foi possível carregar seus chamados.'), 'error');
            setTickets([]);
        } finally {
            setLoadingTickets(false);
        }
    };

    const submitTicket = async (e) => {
        e.preventDefault();
        if (form.message.trim().length < 10) {
            addToast('Descreva o problema com pelo menos 10 caracteres.', 'error');
            return;
        }
        setSubmitting(true);
        try {
            await axios.post(`${import.meta.env.VITE_BASE_URL}/support/tickets`, {
                category: form.category,
                message: form.message.trim(),
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('user')}` },
            });
            addToast('Chamado aberto com sucesso!', 'success');
            setForm({ category: 'other', message: '' });
            await loadTickets();
        } catch (err) {
            addToast(getFriendlyErrorMessage(err, 'Não foi possível abrir o chamado.'), 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const headerBack = () => {
        if (view === 'home') navigate('/account');
        else setView('home');
    };

    const headerTitle =
        view === 'topic' ? (topic?.title || 'Ajuda')
        : view === 'newTicket' ? 'Abrir chamado'
        : view === 'history' ? 'Meus chamados'
        : 'Central de Ajuda';

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title={headerTitle} onBack={headerBack} />

            <div className="flex-1 overflow-y-auto">
                {view === 'home' && (
                    <>
                        <div className="p-5 bg-ink-900 text-white mb-2">
                            <h1 className="text-2xl font-bold mb-2">Como podemos ajudar?</h1>
                            <p className="text-sm text-white/70">Selecione o assunto abaixo para encontrar a solução mais rápida.</p>
                        </div>

                        <div className="bg-surface mb-2 divide-y divide-line">
                            {FAQ_TOPICS.map((item) => (
                                <DetailRow
                                    key={item.id}
                                    icon={item.icon}
                                    iconColor={item.iconColor}
                                    title={item.title}
                                    subtitle={item.subtitle}
                                    className="px-4"
                                    trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true" />}
                                    onClick={() => openTopic(item)}
                                />
                            ))}
                        </div>

                        <div className="p-4">
                            <h3 className="font-semibold text-ink-600 mb-3 px-1">Suporte Direto</h3>
                            <div className="bg-surface rounded-panel border border-line shadow-raised overflow-hidden divide-y divide-line">
                                <DetailRow
                                    icon="ri-whatsapp-fill"
                                    iconColor="text-brand-600"
                                    title="Falar com o suporte (WhatsApp)"
                                    subtitle={contact.whatsappUrl ? 'Atendimento pelo WhatsApp' : 'Indisponível no momento — use um chamado'}
                                    className="px-4"
                                    trailing={<i className="ri-external-link-line text-ink-400" aria-hidden="true" />}
                                    onClick={openWhatsApp}
                                />
                                <DetailRow
                                    icon="ri-mail-fill"
                                    iconColor="text-ink-600"
                                    title="Enviar e-mail"
                                    subtitle={contact.email || 'Indisponível no momento — use um chamado'}
                                    className="px-4"
                                    trailing={<i className="ri-external-link-line text-ink-400" aria-hidden="true" />}
                                    onClick={openEmail}
                                />
                                <DetailRow
                                    icon="ri-ticket-fill"
                                    iconColor="text-ink-600"
                                    title="Abrir novo chamado"
                                    subtitle="Registre um pedido dentro do app"
                                    className="px-4"
                                    trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true" />}
                                    onClick={() => openNewTicket('other')}
                                />
                                <DetailRow
                                    icon="ri-history-line"
                                    iconColor="text-ink-600"
                                    title="Histórico de chamados"
                                    subtitle="Acompanhe abertos e resolvidos"
                                    className="px-4"
                                    trailing={<i className="ri-arrow-right-s-line text-xl text-ink-400" aria-hidden="true" />}
                                    onClick={loadTickets}
                                />
                            </div>
                        </div>
                    </>
                )}

                {view === 'topic' && topic && (
                    <div className="p-5">
                        <div className="flex items-center gap-3 mb-4">
                            <i className={`${topic.icon} ${topic.iconColor} text-2xl`} aria-hidden="true" />
                            <h2 className="text-xl font-semibold text-ink-900">{topic.title}</h2>
                        </div>
                        <div className="flex flex-col gap-3 mb-6">
                            {topic.body.map((paragraph) => (
                                <p key={paragraph.slice(0, 24)} className="text-sm text-ink-600 leading-relaxed">
                                    {paragraph}
                                </p>
                            ))}
                        </div>
                        <Button onClick={() => openNewTicket(topic.category)}>
                            Abrir chamado sobre este assunto
                        </Button>
                        {contact.whatsappUrl && (
                            <Button variant="secondary" className="mt-3" onClick={openWhatsApp}>
                                Falar no WhatsApp
                            </Button>
                        )}
                    </div>
                )}

                {view === 'newTicket' && (
                    <form onSubmit={submitTicket} className="p-5 flex flex-col gap-4">
                        <p className="text-sm text-ink-500">
                            Descreva o que aconteceu. Nossa equipe responde pelo histórico de chamados e pelos canais de contato.
                        </p>
                        <div>
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Assunto</label>
                            <select
                                value={form.category}
                                onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                                className="w-full bg-surface border border-line px-4 py-3 rounded-panel outline-none focus:border-brand-500 font-medium text-ink-900"
                            >
                                <option value="ride_issue">Problemas com uma corrida</option>
                                <option value="lost_item">Objeto perdido</option>
                                <option value="payment">Problemas no pagamento</option>
                                <option value="other">Outro assunto</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-ink-400 ml-1 mb-1 block">Descrição</label>
                            <textarea
                                value={form.message}
                                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
                                rows={6}
                                placeholder="Conte o que aconteceu, com data, horário e detalhes úteis..."
                                className="w-full bg-surface border border-line px-4 py-3 rounded-panel outline-none focus:border-brand-500 text-ink-900 resize-none"
                                required
                                minLength={10}
                                maxLength={2000}
                            />
                        </div>
                        <Button type="submit" loading={submitting}>
                            Enviar chamado
                        </Button>
                    </form>
                )}

                {view === 'history' && (
                    <div className="p-4 flex flex-col gap-3">
                        {loadingTickets ? (
                            <div className="flex justify-center py-16">
                                <i className="ri-loader-4-line text-3xl animate-spin text-ink-400" aria-hidden="true" />
                            </div>
                        ) : tickets.length === 0 ? (
                            <EmptyState
                                icon="ri-ticket-line"
                                title="Nenhum chamado ainda"
                                description="Quando você abrir um chamado, ele aparece aqui."
                                actionLabel="Abrir chamado"
                                onAction={() => openNewTicket('other')}
                            />
                        ) : (
                            tickets.map((ticket) => {
                                const status = STATUS_LABEL[ticket.status] || STATUS_LABEL.open;
                                return (
                                    <div key={ticket._id} className="bg-surface border border-line rounded-panel p-4 shadow-raised">
                                        <div className="flex items-start justify-between gap-3 mb-2">
                                            <p className="font-semibold text-ink-900 text-sm">{ticket.subject}</p>
                                            <StatusBadge tone={status.tone}>{status.text}</StatusBadge>
                                        </div>
                                        <p className="text-sm text-ink-500 mb-2 whitespace-pre-wrap">{ticket.message}</p>
                                        <p className="text-xs text-ink-400">
                                            {new Date(ticket.createdAt).toLocaleString('pt-BR', {
                                                day: '2-digit',
                                                month: 'short',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </p>
                                    </div>
                                );
                            })
                        )}
                        {!loadingTickets && (
                            <Button variant="secondary" onClick={() => openNewTicket('other')}>
                                Abrir novo chamado
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Help;
