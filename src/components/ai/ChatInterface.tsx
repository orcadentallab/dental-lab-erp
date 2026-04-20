/**
 * ChatInterface Component
 * Full chat interface with message history, input, and conversation management
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Plus, Trash2, MessageSquare, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import ChatMessage, { TypingIndicator, WelcomeMessage } from './ChatMessage';
import {
    sendChatMessage,
    createConversation,
    saveMessage,
    getConversations,
    getConversationMessages,
    deleteConversation,
    updateConversationTitle,
    type ChatContext,
    type ChatMessage as ChatMessageType
} from '../../services/gemini';

interface ChatInterfaceProps {
    context: ChatContext;
}

interface Conversation {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

export default function ChatInterface({ context }: ChatInterfaceProps) {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [showConversations, setShowConversations] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Load conversations on mount
    useEffect(() => {
        loadConversations();
    }, []);

    // Scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Auto-resize textarea
    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
        }
    }, [input]);

    const loadConversations = async () => {
        try {
            const data = await getConversations();
            setConversations(data);
        } catch (error) {
            console.error('Error loading conversations:', error);
        }
    };

    const loadMessages = useCallback(async (conversationId: string) => {
        setIsLoading(true);
        try {
            const data = await getConversationMessages(conversationId);
            setMessages(data);
            setActiveConversationId(conversationId);
        } catch (error) {
            console.error('Error loading messages:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleNewConversation = async () => {
        try {
            const id = await createConversation();
            setActiveConversationId(id);
            setMessages([]);
            await loadConversations();
            setShowConversations(false);
        } catch (error) {
            console.error('Error creating conversation:', error);
        }
    };

    const handleDeleteConversation = async (id: string) => {
        if (!confirm('هل أنت متأكد من حذف هذه المحادثة؟')) return;

        try {
            await deleteConversation(id);
            if (activeConversationId === id) {
                setActiveConversationId(null);
                setMessages([]);
            }
            await loadConversations();
        } catch (error) {
            console.error('Error deleting conversation:', error);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isSending) return;

        const userMessage = input.trim();
        setInput('');
        setIsSending(true);

        // Create conversation if none active
        let conversationId = activeConversationId;
        if (!conversationId) {
            try {
                conversationId = await createConversation(userMessage.slice(0, 50));
                setActiveConversationId(conversationId);
                await loadConversations();
            } catch (error) {
                console.error('Error creating conversation:', error);
                setIsSending(false);
                return;
            }
        }

        // Add user message to UI immediately
        const tempUserMessage: Message = {
            id: 'temp-user-' + Date.now(),
            role: 'user',
            content: userMessage,
            created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempUserMessage]);

        try {
            // Save user message
            await saveMessage(conversationId, 'user', userMessage);

            // Get conversation history for context
            const history: ChatMessageType[] = messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            // Send to AI
            const response = await sendChatMessage(userMessage, context, history);

            // Add AI response to UI
            const aiMessage: Message = {
                id: 'temp-ai-' + Date.now(),
                role: 'assistant',
                content: response.response,
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, aiMessage]);

            // Save AI response
            await saveMessage(conversationId, 'assistant', response.response);

            // Update conversation title if first message
            if (messages.length === 0) {
                await updateConversationTitle(conversationId, userMessage.slice(0, 50));
                await loadConversations();
            }

        } catch (error) {
            console.error('Error sending message:', error);
            // Add error message
            const errorMessage: Message = {
                id: 'temp-error-' + Date.now(),
                role: 'assistant',
                content: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.',
                created_at: new Date().toISOString()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsSending(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="bg-white rounded-[2rem] border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 p-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
                        <MessageSquare size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-800">المساعد الذكي</h3>
                        <p className="text-xs text-gray-400">متاح للمساعدة في التحليل</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleNewConversation}
                        className="p-2 rounded-xl text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                        title="محادثة جديدة"
                    >
                        <Plus size={20} />
                    </button>
                    <button
                        onClick={() => setShowConversations(!showConversations)}
                        className={clsx(
                            'p-2 rounded-xl transition-colors',
                            showConversations ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'
                        )}
                        title="المحادثات السابقة"
                    >
                        <ChevronDown size={20} className={clsx(
                            'transition-transform',
                            showConversations && 'rotate-180'
                        )} />
                    </button>
                </div>
            </div>

            {/* Conversations Dropdown */}
            {showConversations && (
                <div className="bg-gray-50 border-b border-gray-200 col-span-full z-20 shadow-inner max-h-60 overflow-y-auto">
                    {conversations.length === 0 ? (
                        <p className="text-sm text-gray-500 p-6 text-center">لا توجد محادثات سابقة</p>
                    ) : (
                        conversations.map(conv => (
                            <div
                                key={conv.id}
                                className={clsx(
                                    'flex items-center justify-between p-4 hover:bg-white cursor-pointer transition-colors border-b border-gray-100 last:border-0 group',
                                    activeConversationId === conv.id && 'bg-white border-l-4 border-l-indigo-500'
                                )}
                                onClick={() => {
                                    loadMessages(conv.id);
                                    setShowConversations(false);
                                }}
                            >
                                <div className="flex-1 min-w-0">
                                    <p className={clsx("text-sm font-medium truncate", activeConversationId === conv.id ? "text-indigo-700" : "text-gray-700")}>
                                        {conv.title}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        {new Date(conv.updated_at).toLocaleDateString('ar-EG')}
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteConversation(conv.id);
                                    }}
                                    className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                    title="حذف المحادثة"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-60">
                        <WelcomeMessage />
                        <div className="mt-8 grid grid-cols-1 gap-3 w-full max-w-xs">
                            <button onClick={() => setInput("ما هو وضع المعمل المالي اليوم؟")} className="text-sm p-3 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:text-indigo-600 transition-all text-right shadow-sm">
                                💰 ما هو وضع المعمل المالي؟
                            </button>
                            <button onClick={() => setInput("من هم أفضل الأطباء هذا الشهر؟")} className="text-sm p-3 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:text-indigo-600 transition-all text-right shadow-sm">
                                👨‍⚕️ من هم أفضل الأطباء؟
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {messages.map((msg, index) => (
                            <ChatMessage
                                key={msg.id || index}
                                role={msg.role}
                                content={msg.content}
                                timestamp={msg.created_at}
                            />
                        ))}
                        {isSending && <TypingIndicator />}
                    </>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-100">
                <div className="flex items-end gap-3 bg-gray-50 rounded-[1.5rem] p-2 border border-gray-200 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-300 transition-all">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="كيف يمكنني مساعدتك اليوم؟"
                        disabled={isSending}
                        className={clsx(
                            'flex-1 resize-none bg-transparent px-4 py-3 text-sm min-h-[50px]',
                            'focus:outline-none text-gray-700',
                            'placeholder:text-gray-400 disabled:cursor-not-allowed',
                            'max-h-[120px]'
                        )}
                        rows={1}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isSending}
                        className={clsx(
                            'p-3 rounded-full transition-all duration-200 mb-1 mr-1',
                            input.trim() && !isSending
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-md transform hover:scale-105'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        )}
                        title="إرسال"
                    >
                        <Send size={20} className={isSending ? 'animate-pulse' : ''} />
                    </button>
                </div>
                <p className="text-[10px] text-gray-300 mt-2 text-center font-light">
                    نظام مدعوم بـ Groq AI
                </p>
            </div>
        </div>
    );
}
