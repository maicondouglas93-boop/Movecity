import React, { useState, useEffect, useRef, useContext } from 'react';
import axios from 'axios';
import { SocketContext } from '@/contexts/SocketContext';
import { getAccessToken } from '@/services/session';

const RideChat = ({ ride, isOpen, onClose, currentUserType }) => {
    const { socket } = useContext(SocketContext);
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [otherIsTyping, setOtherIsTyping] = useState(false);
    const [loading, setLoading] = useState(false);
    
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const typingTimeoutRef = useRef(null);

    const token = getAccessToken(currentUserType === 'captain' ? 'captain' : 'user');

    const quickMessagesCaptain = ['📍 Estou chegando.', '📍 Estou no local.', '⏳ Aguarde 2 minutos.', '🚗 Estou a caminho.', '👍 Ok.', '❌ Não encontrei você.'];
    const quickMessagesUser = ['📍 Estou no local.', '⏳ Já estou descendo.', '👍 Ok.', '❌ Não encontrei você.'];

    const quickMessages = currentUserType === 'captain' ? quickMessagesCaptain : quickMessagesUser;

    useEffect(() => {
        if (!isOpen || !ride) return;

        // Fetch historical messages
        const fetchMessages = async () => {
            setLoading(true);
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/chat/${ride._id}`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (response.data.messages) {
                    setMessages(response.data.messages);
                    // Mark as read after fetching
                    await axios.patch(`${import.meta.env.VITE_BASE_URL}/chat/read`, { rideId: ride._id }, {
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

        // Join socket room
        // A10 da auditoria de push (2026-08-02): o backend agora exige o JWT pra
        // confirmar que quem está entrando na sala é de fato o passageiro ou o
        // motorista desta corrida — sem isso, entra sem autorização e sem ouvir nada.
        socket.emit('join-chat', { rideId: ride._id, token });

        const handleReceiveMessage = (message) => {
            setMessages(prev => [...prev, message]);
            // If chat is open, mark as read immediately
            socket.emit('message-read', { rideId: ride._id, messageId: message._id });
            
            // Smart scroll: only scroll if we're already near bottom
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
            socket.emit('leave-chat', { rideId: ride._id });
            socket.off('receive-message', handleReceiveMessage);
            socket.off('typing-start', handleTypingStart);
            socket.off('typing-stop', handleTypingStop);
        };
    }, [isOpen, ride, socket, token, currentUserType]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleInputChange = (e) => {
        setInputText(e.target.value);
        if (!isTyping) {
            setIsTyping(true);
            socket.emit('typing-start', { rideId: ride._id, senderType: currentUserType });
        }
        
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            socket.emit('typing-stop', { rideId: ride._id, senderType: currentUserType });
        }, 1500);
    };

    const sendMessage = async (textToSend = inputText) => {
        if (!textToSend.trim()) return;

        // Optimistic UI update
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
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/chat/send`, {
                rideId: ride._id,
                message: textToSend,
                type: 'text'
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            // Replace temp message with actual message from server
            setMessages(prev => prev.map(msg => msg._id === tempId ? response.data : msg));
            socket.emit('send-message', { rideId: ride._id, message: response.data });
            
        } catch (err) {
            console.error('Error sending message', err);
            // Revert optimistic update on failure, maybe show error toast
            setMessages(prev => prev.filter(msg => msg._id !== tempId));
        }
    };

    const isRideActive = ride && ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing'].includes(ride.status);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex flex-col bg-gray-100 animate-slide-up sm:w-full sm:max-w-md sm:mx-auto sm:border-x">
            {/* Header */}
            <div className="bg-white px-4 py-3 flex items-center justify-between border-b shadow-sm">
                <div className="flex items-center gap-3">
                    <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
                        <i className="ri-arrow-left-line text-xl"></i>
                    </button>
                    <div>
                        <h3 className="font-semibold text-lg">
                            {currentUserType === 'user' ? 'Motorista' : 'Passageiro'}
                        </h3>
                        <span className="text-xs text-green-600 font-medium">
                            {isRideActive ? 'Online' : 'Corrida Finalizada'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div 
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#e5ddd5]"
            >
                {!isRideActive && (
                    <div className="bg-yellow-100 text-yellow-800 text-xs text-center p-2 rounded-lg my-2 mx-auto max-w-[80%]">
                        Esta conversa foi encerrada porque a corrida não está mais ativa.
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

            {/* Quick Messages */}
            {isRideActive && (
                <div className="bg-white border-t p-2 flex gap-2 overflow-x-auto whitespace-nowrap scrollbar-hide">
                    {quickMessages.map((msg, idx) => (
                        <button 
                            key={idx}
                            onClick={() => sendMessage(msg)}
                            className="bg-gray-100 hover:bg-gray-200 border border-gray-200 text-xs px-3 py-1.5 rounded-full flex-shrink-0"
                        >
                            {msg}
                        </button>
                    ))}
                </div>
            )}

            {/* Input Area */}
            <div className="bg-white p-3 border-t">
                {isRideActive ? (
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
