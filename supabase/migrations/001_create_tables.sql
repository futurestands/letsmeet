CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Meetings table
CREATE TABLE IF NOT EXISTS public.meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  host_id UUID REFERENCES public.users(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- 3. Scheduled meetings
CREATE TABLE IF NOT EXISTS public.scheduled_meetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  duration TEXT NOT NULL DEFAULT '30',
  host_id UUID REFERENCES public.users(id) NOT NULL,
  meeting_code TEXT,
  description TEXT,
  meeting_type TEXT DEFAULT 'video',
  recurring BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Meeting participants
CREATE TABLE IF NOT EXISTS public.meeting_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  user_name TEXT NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_host BOOLEAN DEFAULT false
);

-- 5. Chat messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  user_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Meeting invites
CREATE TABLE IF NOT EXISTS public.meeting_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invites ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view all users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Anyone can view meetings" ON public.meetings FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create meetings" ON public.meetings FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update meetings" ON public.meetings FOR UPDATE USING (auth.uid() = host_id);

CREATE POLICY "Anyone can view scheduled meetings" ON public.scheduled_meetings FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create scheduled meetings" ON public.scheduled_meetings FOR INSERT WITH CHECK (auth.uid() = host_id);
CREATE POLICY "Host can update scheduled meetings" ON public.scheduled_meetings FOR UPDATE USING (auth.uid() = host_id);
CREATE POLICY "Host can delete scheduled meetings" ON public.scheduled_meetings FOR DELETE USING (auth.uid() = host_id);

CREATE POLICY "Anyone can view participants" ON public.meeting_participants FOR SELECT USING (true);
CREATE POLICY "Authenticated users can join meetings" ON public.meeting_participants FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view chat messages" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "Authenticated users can send messages" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view invites" ON public.meeting_invites FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create invites" ON public.meeting_invites FOR INSERT WITH CHECK (true);
