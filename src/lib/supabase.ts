import { createClient } from '@supabase/supabase-js';
const supabaseUrl = 'https://wvmmofornwivfsjeqmda.supabase.co';
const supabaseKey = 'sb_publishable_hGcc9yoGrZy9LjZ33FtuSA_obXX89GK';
export const supabase = createClient(supabaseUrl, supabaseKey);
export interface User { id: string; email: string; full_name: string; avatar_url?: string; created_at: string; }
