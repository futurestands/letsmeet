/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '../lib/supabase';

type AuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    guest?: boolean;
  };
};

type AuthResult = {
  error: { message?: string } | null;
};

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  applySession: (session: {
    access_token: string;
    refresh_token: string;
  }) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isGuestAuthUser(authUser: AuthUser) {
  const email = String(authUser.email ?? '').toLowerCase();
  return Boolean(authUser.user_metadata?.guest) || email.endsWith('@guest.letsmeet.invalid');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  const loadUserProfile = async (authUser: AuthUser) => {
    const guest = isGuestAuthUser(authUser);
    setIsGuest(guest);

    const fallbackUser: User = {
      id: authUser.id,
      email: authUser.email ?? '',
      full_name: authUser.user_metadata?.full_name ?? authUser.email?.split('@')[0] ?? 'User',
      created_at: new Date().toISOString(),
    };

    try {
      // 1. Load user profile row
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (userError && !['PGRST116', '42P01'].includes(userError.code ?? '')) {
        console.error('Failed to load user profile', userError);
      }

      // 2. Load organization context
      const { data: membership, error: membershipError } = await supabase
        .from('organization_members')
        .select('organization_id, status')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (membershipError) {
        console.error('Failed to load organization context', membershipError);
      }

      // 3. Provision if either profile or organization context is missing
      if (!userData || (!guest && !membership)) {
        if (guest) {
          // Guests get a profile row only — never an organization/workspace.
          const { error: upsertError } = await supabase.from('users').upsert({
            id: authUser.id,
            email: fallbackUser.email || `${authUser.id}@guest.letsmeet.invalid`,
            full_name: fallbackUser.full_name,
          }, { onConflict: 'id' });
          if (upsertError) {
            console.error('Failed to persist guest profile', upsertError);
          }
        } else {
          // Real users get full organization context. Call is idempotent.
          const { error: contextError } = await supabase.rpc('ensure_user_profile_context', {
            p_user_id: authUser.id,
            p_email: authUser.email ?? '',
            p_full_name: fallbackUser.full_name,
          });

          if (contextError && contextError.code !== '42P01') {
            console.error('Failed to provision user context', contextError);
          }
        }

        // Reload profile and context after provisioning
        const { data: reloadedProfile } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle();
        setUser((reloadedProfile as User | null) ?? fallbackUser);
      } else {
        setUser((userData as User | null) ?? fallbackUser);
      }
    } catch (error) {
      console.error('Auth context initialization failed', error);
      setUser(fallbackUser);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const bootstrapSession = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;

      if (session?.user) {
        await loadUserProfile(session.user);
      } else {
        setUser(null);
        setIsGuest(false);
        setLoading(false);
      }
    };

    void bootstrapSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadUserProfile(session.user);
      } else {
        setUser(null);
        setIsGuest(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, fullName: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    return { error: error ? { message: error.message } : null };
  };

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      await loadUserProfile(data.user);
    }
    return { error: error ? { message: error.message } : null };
  };

  const applySession = async (session: {
    access_token: string;
    refresh_token: string;
  }): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (error) return { error: { message: error.message } };
    if (data.user) await loadUserProfile(data.user);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsGuest(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isGuest, signUp, signIn, signOut, applySession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
