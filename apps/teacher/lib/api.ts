import { createClient } from '@supabase/supabase-js';
import type { Broadcast, Classroom } from './domain';
export const configured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
export const supabase = configured ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null;
export const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || 'admin@broadcast.local';
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function api<T>(input: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.functions.invoke('broadcast-api', { body: input });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || '请求未完成，请检查网络后重试');
  }
  if (data.error) throw new Error(data.error);
  return data as T;
}
export const getClassrooms = () => rpc<{ server_now: string; classrooms: Classroom[] }>('classroom_status');
export const getHistory = (before: string | null = null, id: string | null = null) =>
  rpc<Broadcast[]>('broadcast_history', { p_before: before, p_id: id });
