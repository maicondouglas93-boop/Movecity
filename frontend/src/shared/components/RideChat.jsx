import React, { useState, useEffect, useRef, useContext } from 'react';
import api from '@/shared/services/axios';
import { SocketContext } from '@/shared/contexts/SocketContext';
import { getAccessToken } from '@/shared/services/session';

const RIDE_ACTIVE = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing'];
const PARCEL_ACTIVE = [
    'provider_accepted',
    'going_to_pickup',
    'arrived_pickup',
    'collected',
    'in_transit',
    'arrived_destination',
];

/**
 * Chat genérico ride|parcel.
 * Props:
 * - subject / ride: documento com `_id` e `status` (ride mantido por compat)
 * - subjectType: 'ride' | 'parcel' (default 'ride')
 */
const RideChat = ({ ride, subject, subjectType = 'ride', isOpen, onClose, currentUserType, deliveryPin }) => {
    const { socket } = useContext(SocketContext);
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [otherIsTyping, setOtherIsTyping] = useState(false);
    const [loading, setLoading] = useState(false);

    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const typingTimeoutRef = useRef(null);

    const doc = subject || ride;
    const type = subjectType === 'parcel' ? 'parcel' : 'ride';
    const subjectId = doc?._id;
    const token = getAccessToken(currentUserType === 'captain' ? 'captain' : 'user');

    const socketPayload = () => (
        type === 'parcel'
            ? { subjectType: 'parcel', subjectId, token }
            : { subjectType: 'ride', subjectId, rideId: subjectId, token }
    );

    const restSubjectBody = () => (
        type === 'parcel'
            ? { subjectType: 'parcel', subjectId }
            : { subjectType: 'ride', subjectId, rideId: subjectId }
    );

    const quickMessagesCaptain = type === 'parcel'
        ? ['📍 Estou chegando.', '📍 Estou no local.', '⏳ Aguarde 2 minutos.', '📦 Objeto coletado.', '👍 Ok.']
        : ['📍 Estou chegando.', '📍 Estou no local.', '⏳ Aguarde 2 minutos.', '🚗 Estou a caminho.', '👍 Ok.', '❌ Não encontrei você.'];
    const quickMessagesUser = type === 'parcel'
        ? ['📍 Estou no local.', '📦 Pronto para retirar.', '👍 Ok.']
        : ['📍 Estou no local.', '⏳ Já estou descendo.', '👍 Ok.', '❌ Não encontrei você.'];

    const quickMessages = currentUserType === 'captain' ? quickMessagesCaptain : quickMessagesUser;
    const peerLabel = currentUserType === 'user'
        ? (type === 'parcel' ? 'Prestador' : 'Motorista')
        : (type === 'parcel' ? 'Cliente' : 'Passageiro');

    useEffect(() => {
        if (!isOpen || !doc || !subjectId) return;

        const fetchMessages = async () => {
            setLoading(true);
            try {
                const path = type === 'parcel'
                    ? `${import.meta.env.VITE_BASE_URL}/chat/parcel/${subjectId}`
                    : `${import.meta.env.VITE_BASE_URL}/chat/${subjectId}`;
                const response = await api.get(path, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (response.data.messages) {
                    setMessages(response.data.messages);
                    await api.patch(`${import.meta.env.VITE_BASE_URL}/chat/read`, restSubjectBody(), {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                }
            } catch (err) {
                console.error('Error fetching messages', err);
            } finally {
                setLoading(false);
                scrollToBottom();
            }
        };

        fetchMessages();

        socket.emit('join-chat', socketPayload());

        const handleReceiveMessage = (message) => {
            setMessages(prev => (
                prev.some((item) => item._id === message._id) ? prev : [...prev, message]
            ));
            socket.emit('message-read', { ...socketPayload(), messageId: message._id });

            if (chatContainerRef.current) {
                const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
                const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
                if (isNearBottom) {
                    setTimeout(scrollToBottom, 100);
                }
            }
        };

        const handleTypingStart = ({ senderType }) => {
            if (senderType !== currentUserType) {
                setOtherIsTyping(true);
            }
        };

        const handleTypingStop = ({ senderType }) => {
            if (senderType !== currentUserType) {
                setOtherIsTyping(false);
            }
        };

        socket.on('receive-message', handleReceiveMessage);
        socket.on('typing-start', handleTypingStart);
        socket.on('typing-stop', handleTypingStop);

        return () => {
            socket.emit('leave-chat', socketPayload());
            socket.off('receive-message', handleReceiveMessage);
            socket.off('typing-start', handleTypingStart);
            socket.off('typing-stop', handleTypingStop);
        };
    }, [isOpen, subjectId, type, socket, token, currentUserType]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleInputChange = (e) => {
        setInputText(e.target.value);
        if (!isTyping) {
            setIsTyping(true);
            socket.emit('typing-start', { ...socketPayload(), senderType: currentUserType });
        }

        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            socket.emit('typing-stop', { ...socketPayload(), senderType: currentUserType });
        }, 1500);
    };

    const sendMessage = async (textToSend = inputText, operationalType = undefined) => {
        if (!textToSend.trim()) return;

        const tempId = Date.now().toString();
        const newMessage = {
            _id: tempId,
            message: textToSend,
            senderType: currentUserType,
            status: 'sent',
            createdAt: new Date().toISOString()
        };

        setMessages(prev => [...prev, newMessage]);
        setInputText('');
        scrollToBottom();

        try {
            const response = await api.post(`${import.meta.env.VITE_BASE_URL}/chat/send`, {
                ...restSubjectBody(),
                message: textToSend,
                type: 'text',
                ...(operationalType ? { operationalType } : {}),
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setMessages(prev => prev.map(msg => msg._id === tempId ? response.data : msg));

        } catch (err) {
            console.error('Error sending message', err);
            setMessages(prev => prev.filter(msg => msg._id !== tempId));
        }
    };

    const activeStatuses = type === 'parcel' ? PARCEL_ACTIVE : RIDE_ACTIVE;
    const isActive = doc && activeStatuses.includes(doc.status);
    const canSendPin = type === 'parcel'
        && currentUserType === 'user'
        && Boolean(deliveryPin)
        && isActive;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-gray-100 animate-slide-up sm:w-full sm:max-w-md sm:mx-auto sm:border-x">
            <div className="bg-white px-4 py-3 flex items-center justify-between border-b shadow-sm">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
                        <i className="ri-arrow-left-line text-xl"></i>
                    </button>
                    <div>
                        <h3 className="font-semibold text-lg">{peerLabel}</h3>
                        <span className="text-xs text-green-600 font-medium">
                            {isActive ? 'Online' : (type === 'parcel' ? 'Encomenda finalizada' : 'Corrida Finalizada')}
                        </span>
                    </div>
                </div>
            </div>

            <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto overscroll-y-contain p-4 space-y-4 bg-[#e5ddd5]"
            >
                {!isActive && (
                    <div className="bg-yellow-100 text-yellow-800 text-xs text-center p-2 rounded-lg my-2 mx-auto max-w-[80%]">
                        Esta conversa foi encerrada.
                    </div>
                )}

                {loading && <div className="text-center text-sm text-gray-500">Carregando...</div>}

                {messages.map((msg, index) => {
                    const isMine = msg.senderType === currentUserType;
                    return (
                        <div key={msg._id || index} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[75%] rounded-xl px-3 py-2 shadow-sm relative pb-4 ${isMine ? 'bg-[#dcf8c6] rounded-tr-sm' : 'bg-white rounded-tl-sm'}`}>
                                <p className="text-sm text-gray-800">{msg.message}</p>
                                <span className="text-[10px] text-gray-500 absolute bottom-1 right-2 flex items-center gap-1">
                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {isMine && (
                                        <i className={`ri-check-double-line ${msg.status === 'read' ? 'text-blue-500' : 'text-gray-400'}`}></i>
                                    )}
                                </span>
                            </div>
                        </div>
                    );
                })}

                {otherIsTyping && (
                    <div className="flex justify-start">
                        <div className="bg-white rounded-xl rounded-tl-sm px-4 py-2 shadow-sm text-sm text-gray-500 italic flex gap-1">
                            Digitando<span className="animate-bounce">.</span><span className="animate-bounce" style={{animationDelay: '100ms'}}>.</span><span className="animate-bounce" style={{animationDelay: '200ms'}}>.</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {isActive && (
                <div className="bg-white border-t p-2 flex gap-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
                    {canSendPin && (
                        <button
                            type="button"
                            onClick={() => sendMessage(`PIN da entrega: ${deliveryPin}`, 'delivery_pin')}
                            className="bg-brand-50 hover:bg-brand-100 border border-brand-200 text-brand-700 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
                        >
                            🔑 Enviar PIN
                        </button>
                    )}
                    {quickMessages.map((msg, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => sendMessage(msg)}
                            className="bg-gray-100 hover:bg-gray-200 border border-gray-200 text-xs px-3 py-1.5 rounded-full flex-shrink-0"
                        >
                            {msg}
                        </button>
                    ))}
                </div>
            )}

            <div className="bg-white p-3 border-t">
                {isActive ? (
                    <div className="flex items-center gap-2 bg-gray-100 rounded-full px-4 py-2">
                        <input
                            type="text"
                            placeholder="Mensagem..."
                            className="bg-transparent flex-1 outline-none text-sm"
                            value={inputText}
                            onChange={handleInputChange}
                            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                            maxLength={500}
                        />
                        <button
                            onClick={() => sendMessage()}
                            disabled={!inputText.trim()}
                            className={`p-1.5 rounded-full transition-colors flex items-center justify-center ${inputText.trim() ? 'bg-black text-white' : 'bg-gray-300 text-gray-500'}`}
                        >
                            <i className="ri-send-plane-fill"></i>
                        </button>
                    </div>
                ) : (
                    <div className="text-center text-sm text-gray-500 italic py-2">
                        O chat está desativado.
                    </div>
                )}
            </div>
        </div>
    );
};

export default RideChat;
