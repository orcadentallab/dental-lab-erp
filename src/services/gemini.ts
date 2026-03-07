/* eslint-disable @typescript-eslint/consistent-type-assertions */
/**
 * Gemini Service - Frontend client for AI Analytics
 * Calls Supabase Edge Functions (NOT Gemini directly for security)
 */

import { supabase } from './supabase';

export interface ChatContext {
    orderCount: number;
    revenue: number;
    productionCosts: number;
    operatingExpenses: number;
    expenses?: number;
    profit: number;
    topDoctors: { name: string; orderCount: number }[];
    topServices: { name: string; count: number }[];
    recentOrders: { patientName: string; status: string; totalPrice: number }[];
}

export interface AnalyzeContext {
    // Current Monthly Data
    currentMonth?: {
        revenue: number;
        profit: number;
        productionCosts: number;
        operatingExpenses: number;
        completedOrders: number;
        pendingOrders: number;
    };
    // Previous Monthly Data
    previousMonth?: {
        revenue: number;
        profit: number;
        completedOrders: number;
    };
    // All-time Totals
    allTime?: {
        revenue: number;
        profit: number;
        pendingPayments: number;
        collectionRate: number;
    };

    // Legacy flat fields (kept for backward compatibility with old local saved contexts)
    orderCount?: number;
    completedOrders?: number;
    pendingOrders?: number;
    revenue?: number;
    productionCosts?: number;
    operatingExpenses?: number;
    expenses?: number;
    profit?: number;
    profitMargin?: number;
    grossMargin?: number;
    topDoctors: { name: string; orderCount: number; revenue: number }[];
    topServices: { name: string; count: number; revenue: number }[];
    ordersByStatus: { status: string; count: number }[];
    revenueByMonth?: { month: string; revenue: number }[];
    collectionRate?: number;
    pendingPayments?: number;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

// Legacy insight format (for backwards compatibility with old saved data)
export interface LegacyInsight {
    title: string;
    content: string;
    type: 'positive' | 'negative' | 'neutral' | 'action';
    icon: string;
}

// New insight format (v2.0)
export interface Insight {
    id: string;
    title: string;
    content: string;
    category: 'performance' | 'finance' | 'operations' | 'risk' | 'opportunity';
    severity: 'positive' | 'neutral' | 'negative';
}

export interface ChatResponse {
    response: string;
    model_version: string;
    prompt_version: string;
}

// New analyze response format (v2.0)
export interface AnalyzeResponse {
    record_type: 'ai_analysis';
    analysis_scope: 'weekly_auto' | 'on_demand_chat';
    analysis_id: string;
    generated_at: string;
    period: {
        from: string;
        to: string;
    };
    executive_summary: string;
    insights: Insight[];
    confidence_level: 'high' | 'medium' | 'low';
    // Backwards compatibility fields
    model_version?: string;
    prompt_version?: string;
}

export interface InsightReport {
    id: string;
    insight_type: string;
    content: string;
    rating: string | null;
    created_at: string;
    model_version: string;
    prompt_version: string;
}

/**
 * Send a chat message to the AI
 */
export async function sendChatMessage(
    message: string,
    context: ChatContext,
    conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        throw new Error('Not authenticated');
    }

    const response = await supabase.functions.invoke('gemini-chat', {
        body: {
            message,
            context,
            conversationHistory
        }
    });

    if (response.error) {
        console.error('Chat error:', response.error);
        throw new Error(response.error.message || 'حدث خطأ في المحادثة');
    }

    return response.data;
}

/**
 * Generate weekly insights
 */
export async function generateInsights(
    context: AnalyzeContext,
    insightType: 'weekly_auto' | 'on_demand' = 'on_demand'
): Promise<AnalyzeResponse> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        throw new Error('Not authenticated');
    }

    // Explicitly pass Authorization header to ensure it's sent
    const response = await supabase.functions.invoke('gemini-analyze', {
        body: { context, insightType },
        headers: {
            Authorization: `Bearer ${session.access_token}`
        }
    });

    if (response.error) {
        console.error('Analyze error:', response.error);
        throw new Error(response.error.message || 'حدث خطأ في التحليل');
    }

    return response.data;
}

/**
 * Save insight to database
 */
export async function saveInsight(
    insightType: 'weekly_auto' | 'on_demand',
    content: string,
    dataContext: AnalyzeContext | ChatContext,
    modelVersion: string = 'gemini-1.5-flash',
    promptVersion: string = 'v1.0'
): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
        .from('ai_insights')
        .insert({
            insight_type: insightType,
            content,
            data_context: dataContext,
            model_version: modelVersion,
            prompt_version: promptVersion,
            created_by: user.id
        })
        .select('id')
        .single();

    if (error) {
        console.error('Save insight error:', error);
        throw new Error('فشل حفظ التحليل');
    }

    return data.id;
}

/**
 * Rate an insight
 */
export async function rateInsight(
    insightId: string,
    rating: 'useful' | 'not_useful'
): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Not authenticated');
    }

    const { error } = await supabase
        .from('ai_insights')
        .update({
            rating,
            rated_at: new Date().toISOString(),
            rated_by: user.id
        })
        .eq('id', insightId);

    if (error) {
        console.error('Rate insight error:', error);
        throw new Error('فشل تقييم التحليل');
    }
}

/**
 * Get saved insights
 */
export async function getInsights(
    type?: 'weekly_auto' | 'on_demand',
    limit: number = 10
): Promise<InsightReport[]> {
    console.log('[getInsights] Loading insights from database...');
    console.log('[getInsights] Type filter:', type || 'all');

    let query = supabase
        .from('ai_insights')
        .select('id, insight_type, content, rating, created_at, model_version, prompt_version')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (type) {
        query = query.eq('insight_type', type);
    }

    const { data, error } = await query;

    if (error) {
        console.error('[getInsights] Database error:', error);
        console.error('[getInsights] Error code:', error.code);
        console.error('[getInsights] Error details:', error.details);
        console.error('[getInsights] Error hint:', error.hint);
        throw new Error('فشل جلب التحليلات');
    }

    console.log('[getInsights] Loaded', data?.length || 0, 'insights');
    if (data && data.length > 0) {
        console.log('[getInsights] First insight ID:', data[0].id);
        console.log('[getInsights] First insight type:', data[0].insight_type);
    }
    return data || [];
}

/**
 * Create a new conversation
 */
export async function createConversation(title?: string): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        throw new Error('Not authenticated');
    }

    const { data, error } = await supabase
        .from('ai_conversations')
        .insert({
            user_id: user.id,
            title: title || 'محادثة جديدة'
        })
        .select('id')
        .single();

    if (error) {
        console.error('Create conversation error:', error);
        throw new Error('فشل إنشاء المحادثة');
    }

    return data.id;
}

/**
 * Save a message to a conversation
 */
export async function saveMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string
): Promise<string> {
    const { data, error } = await supabase
        .from('ai_messages')
        .insert({
            conversation_id: conversationId,
            role,
            content
        })
        .select('id')
        .single();

    if (error) {
        console.error('Save message error:', error);
        throw new Error('فشل حفظ الرسالة');
    }

    return data.id;
}

/**
 * Get conversations
 */
export async function getConversations(limit: number = 20): Promise<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
}[]> {
    const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, title, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Get conversations error:', error);
        throw new Error('فشل جلب المحادثات');
    }

    return data || [];
}

/**
 * Get messages for a conversation
 */
export async function getConversationMessages(conversationId: string): Promise<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}[]> {
    const { data, error } = await supabase
        .from('ai_messages')
        .select('id, role, content, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Get messages error:', error);
        throw new Error('فشل جلب الرسائل');
    }

    type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; created_at: string };
    return (data || []).map(d => d as unknown as ChatMessage);
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(
    conversationId: string,
    title: string
): Promise<void> {
    const { error } = await supabase
        .from('ai_conversations')
        .update({ title })
        .eq('id', conversationId);

    if (error) {
        console.error('Update conversation error:', error);
        throw new Error('فشل تحديث المحادثة');
    }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId: string): Promise<void> {
    const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', conversationId);

    if (error) {
        console.error('Delete conversation error:', error);
        throw new Error('فشل حذف المحادثة');
    }
}

/**
 * Check if weekly insights need to be generated
 * Returns true if last insight is older than 7 days
 */
export async function needsWeeklyInsight(): Promise<boolean> {
    const { data, error } = await supabase
        .from('ai_insights')
        .select('created_at')
        .eq('insight_type', 'weekly_auto')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Check weekly insight error:', error);
        return true; // Generate if error
    }

    if (!data || data.length === 0) {
        return true; // No insights yet
    }

    const lastInsight = new Date(data[0].created_at);
    const now = new Date();
    const daysDiff = (now.getTime() - lastInsight.getTime()) / (1000 * 60 * 60 * 24);

    return daysDiff >= 7;
}
