import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (isSignUp) {
      const { error } = await signUp(email, password, fullName);
      if (error) setError(error.message || 'Failed to sign up');
      else navigate('/');
    } else {
      const { error } = await signIn(email, password);
      if (error) setError(error.message || 'Failed to sign in');
      else navigate('/');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-[#1a73e8] to-[#6c63ff] rounded-xl flex items-center justify-center mx-auto mb-4">
            <Video className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">LeTs<span className="text-[#1a73e8]">Meet</span></h1>
          <p className="text-gray-500 text-sm mt-2">{isSignUp ? 'Create your account' : 'Welcome back'}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Full Name" className="input-field pl-10" required />
              </div>
            )}
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="input-field pl-10" required />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="input-field pl-10" required minLength={6} />
            </div>
            {error && <div className="p-3 bg-red-50 border border-red-100 rounded-lg"><p className="text-sm text-red-600">{error}</p></div>}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? 'Processing...' : <>{isSignUp ? 'Create Account' : 'Sign In'}<ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button onClick={() => { setIsSignUp(!isSignUp); setError(''); }} className="text-[#1a73e8] font-medium hover:underline">
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
