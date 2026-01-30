/**
 * ChatMessage Component
 * Displays a single chat message (user or assistant)
 */

import { Bot, User } from 'lucide-react';
import clsx from 'clsx';

interface ChatMessageProps {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
}

export default function ChatMessage({ role, content, timestamp }: ChatMessageProps) {
    const isUser = role === 'user';

    return (
        <div className={clsx(
            'flex gap-3 mb-4',
            isUser ? 'flex-row-reverse' : 'flex-row'
        )}>
            {/* Avatar */}
            <div className={clsx(
                'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
                isUser ? 'bg-blue-500' : 'bg-gradient-to-br from-purple-500 to-indigo-600'
            )}>
                {isUser ? (
                    <User size={18} className="text-white" />
                ) : (
                    <Bot size={18} className="text-white" />
                )}
            </div>

            {/* Message Bubble */}
            <div className={clsx(
                'max-w-[80%] rounded-2xl px-4 py-3',
                isUser
                    ? 'bg-blue-500 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
            )}>
                <p className="whitespace-pre-wrap leading-relaxed text-sm">
                    {content}
                </p>
                {timestamp && (
                    <span className={clsx(
                        'text-xs mt-1 block',
                        isUser ? 'text-blue-100' : 'text-gray-400'
                    )}>
                        {new Date(timestamp).toLocaleTimeString('ar-EG', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * TypingIndicator - Shows when AI is thinking
 */
export function TypingIndicator() {
    return (
        <div className="flex gap-3 mb-4">
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
                <Bot size={18} className="text-white" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
            </div>
        </div>
    );
}

/**
 * WelcomeMessage - Initial AI greeting
 */
export function WelcomeMessage() {
    return (
        <ChatMessage
            role="assistant"
            content="مرحباً! 👋 أنا مساعد تحليل بيانات المعمل. يمكنني مساعدتك في:

• تحليل الطلبات والإيرادات
• مراجعة أداء الأطباء
• فهم اتجاهات الخدمات
• الإجابة على أسئلتك عن البيانات

كيف يمكنني مساعدتك اليوم؟"
        />
    );
}
