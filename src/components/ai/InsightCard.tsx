/**
 * InsightCard Component
 * Displays an AI-generated insight with rating buttons
 * Supports both new (category/severity) and legacy (type/icon) formats
 */

import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, TrendingUp, TrendingDown, Lightbulb, AlertTriangle, CheckCircle, Target, DollarSign, Settings, Zap } from 'lucide-react';
import clsx from 'clsx';
import { rateInsight } from '../../services/gemini';

interface InsightCardProps {
    id?: string;
    title: string;
    content: string;
    // New format fields
    category?: 'performance' | 'finance' | 'operations' | 'risk' | 'opportunity';
    severity?: 'positive' | 'neutral' | 'negative';
    // Legacy format fields (backwards compatibility)
    type?: 'positive' | 'negative' | 'neutral' | 'action';
    icon?: string;
    createdAt?: string;
    rating?: 'useful' | 'not_useful' | null;
    showRating?: boolean;
}

// Severity-based styling (new format)
const severityStyles = {
    positive: {
        border: 'border-l-4 border-l-emerald-500',
        iconBg: 'bg-emerald-100 text-emerald-600',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        shadow: 'shadow-sm hover:shadow-emerald-100'
    },
    negative: {
        border: 'border-l-4 border-l-rose-500',
        iconBg: 'bg-rose-100 text-rose-600',
        badge: 'bg-rose-50 text-rose-700 border-rose-100',
        shadow: 'shadow-sm hover:shadow-rose-100'
    },
    neutral: {
        border: 'border-l-4 border-l-blue-500',
        iconBg: 'bg-blue-100 text-blue-600',
        badge: 'bg-blue-50 text-blue-700 border-blue-100',
        shadow: 'shadow-sm hover:shadow-blue-100'
    }
};

// Legacy type-based styling (kept for reference, uses severityStyles)
// const typeStyles = { positive, negative, neutral, action: amber }

// Category-based icons (new format)
const categoryIcons: Record<string, typeof TrendingUp> = {
    performance: TrendingUp,
    finance: DollarSign,
    operations: Settings,
    risk: AlertTriangle,
    opportunity: Zap
};

// Legacy emoji-based icons
const iconMap: Record<string, typeof TrendingUp> = {
    '📈': TrendingUp,
    '📉': TrendingDown,
    '💡': Lightbulb,
    '⚠️': AlertTriangle,
    '✅': CheckCircle,
    '🎯': Target
};

// Category labels in Arabic
const categoryLabels: Record<string, string> = {
    performance: 'الأداء',
    finance: 'المالية',
    operations: 'العمليات',
    risk: 'المخاطر',
    opportunity: 'الفرص'
};

function getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return 'الآن';
    if (diffMinutes < 60) return `منذ ${diffMinutes} دقيقة`;
    if (diffHours < 24) return `منذ ${diffHours} ساعة`;
    if (diffDays < 7) return `منذ ${diffDays} يوم`;
    return date.toLocaleDateString('ar-EG');
}

const InsightCard = React.memo(function InsightCard({
    id,
    title,
    content,
    category,
    severity,
    type,
    icon = '💡',
    createdAt,
    rating,
    showRating = true
}: InsightCardProps) {
    const [currentRating, setCurrentRating] = useState<'useful' | 'not_useful' | null>(rating || null);
    const [isRating, setIsRating] = useState(false);

    // Determine styling: prefer severity (new format), fall back to type (legacy)
    const resolvedSeverity = severity || (type === 'action' ? 'neutral' : type) || 'neutral';
    const styles = severityStyles[resolvedSeverity as keyof typeof severityStyles] || severityStyles.neutral;

    // Determine icon: prefer category-based (new format), fall back to emoji icon (legacy)
    const IconComponent = category ? (categoryIcons[category] || Lightbulb) : (iconMap[icon] || Lightbulb);

    // Get category label for display
    const categoryLabel = category ? categoryLabels[category] : null;

    const handleRate = async (newRating: 'useful' | 'not_useful') => {
        if (!id || isRating || currentRating === newRating) return;

        setIsRating(true);
        try {
            await rateInsight(id, newRating);
            setCurrentRating(newRating);
        } catch (error) {
            console.error('Rating error:', error);
        } finally {
            setIsRating(false);
        }
    };

    return (
        <div className={clsx(
            'bg-white p-5 rounded-xl border border-gray-100 transition-all duration-300',
            styles.border,
            styles.shadow
        )}>
            <div className="flex gap-4">
                <div className={clsx(
                    'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105',
                    styles.iconBg
                )}>
                    <IconComponent size={24} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-bold text-gray-900 text-lg leading-tight">
                            {title}
                        </h3>
                        {createdAt && (
                            <span className="text-xs text-gray-400 font-medium whitespace-nowrap bg-gray-50 px-2 py-1 rounded-full">
                                {getRelativeTime(createdAt)}
                            </span>
                        )}
                    </div>

                    <div className="prose prose-sm max-w-none text-gray-600 leading-relaxed mb-4 whitespace-pre-line">
                        {content}
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-50">
                        {/* Category Badge (new format) */}
                        {categoryLabel && (
                            <span className={clsx(
                                'text-xs px-2 py-1 rounded-full font-medium border',
                                styles.badge
                            )}>
                                {categoryLabel}
                            </span>
                        )}

                        {/* Rating (only if ID exists) */}
                        {showRating && id && (
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400 ml-2">هل كان هذا مفيداً؟</span>
                                <button
                                    onClick={() => handleRate('useful')}
                                    disabled={isRating}
                                    title="مفيد"
                                    aria-label="تقييم مفيد"
                                    className={clsx(
                                        'p-1.5 rounded-lg transition-all',
                                        currentRating === 'useful'
                                            ? 'bg-emerald-100 text-emerald-600'
                                            : 'hover:bg-gray-100 text-gray-400 hover:text-emerald-600'
                                    )}
                                >
                                    <ThumbsUp size={14} />
                                </button>
                                <button
                                    onClick={() => handleRate('not_useful')}
                                    disabled={isRating}
                                    title="غير مفيد"
                                    aria-label="تقييم غير مفيد"
                                    className={clsx(
                                        'p-1.5 rounded-lg transition-all',
                                        currentRating === 'not_useful'
                                            ? 'bg-rose-100 text-rose-600'
                                            : 'hover:bg-gray-100 text-gray-400 hover:text-rose-600'
                                    )}
                                >
                                    <ThumbsDown size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default InsightCard;

/**
 * InsightCardSkeleton - Loading state for InsightCard
 */
export function InsightCardSkeleton() {
    return (
        <div className="relative p-5 rounded-2xl border border-gray-200 bg-gray-50 animate-pulse">
            <div className="flex items-start gap-3 mb-3">
                <div className="w-11 h-11 rounded-xl bg-gray-300" />
                <div className="flex-1 h-6 bg-gray-300 rounded" />
            </div>
            <div className="space-y-2 mb-4">
                <div className="h-4 bg-gray-300 rounded w-full" />
                <div className="h-4 bg-gray-300 rounded w-3/4" />
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <div className="h-3 bg-gray-300 rounded w-20" />
                <div className="flex gap-2">
                    <div className="w-8 h-8 bg-gray-300 rounded-lg" />
                    <div className="w-8 h-8 bg-gray-300 rounded-lg" />
                </div>
            </div>
        </div>
    );
}
