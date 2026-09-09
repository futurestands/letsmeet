import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Calendar, Users, Shield, Zap, MessageSquare, Monitor, Hand, Smile, Play, Mic, Camera, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
export default function Home() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [meetingCode, setMeetingCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const start = () => navigate('/meet?mode=new');
  const join = () => { if (meetingCode.trim()) navigate('/meet?code=' + meetingCode); };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-effect border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-[#1a73e8] to-[#6c63ff] rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div>
            <span className="text-xl font-bold text-gray-900">LeTs<span className="text-[#1a73e8]">Meet</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowJoinModal(true)} className="btn-secondary text-sm">Join</button>
            <button onClick={start} className="btn-primary text-sm">Start Meeting</button>
            {user && (<div className="relative group"><button className="w-9 h-9 bg-[#1a73e8] rounded-full flex items-center justify-center text-white font-semibold text-sm">{user.full_name?.charAt(0).toUpperCase()||'U'}</button><div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all"><div className="px-4 py-2 border-b border-gray-100"><p className="text-sm font-medium truncate">{user.full_name}</p><p className="text-xs text-gray-500 truncate">{user.email}</p></div><button onClick={() => navigate('/settings')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50">Settings</button><button onClick={signOut} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><LogOut className="w-4 h-4"/>Sign Out</button></div></div>)}
          </div>
        </div>
      </nav>
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-[#e8f0fe] text-[#1a73e8] px-4 py-2 rounded-full text-sm font-medium"><Zap className="w-4 h-4"/>Up to 500 participants</div>
            <h1 className="text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">Video meetings, <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#1a73e8] to-[#6c63ff]">reimagined</span></h1>
            <p className="text-lg text-gray-600 max-w-lg">Premium video conferencing for teams of every size.</p>
            <div className="flex gap-4">
              <button onClick={start} className="btn-primary flex items-center gap-2 px-8 py-3.5"><Play className="w-5 h-5"/>Start a meeting</button>
              <button onClick={() => navigate('/schedule')} className="btn-secondary flex items-center gap-2 px-8 py-3.5"><Calendar className="w-5 h-5"/>Schedule</button>
            </div>
          </div>
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-4 shadow-2xl">
            <div className="grid grid-cols-3 gap-2">{['bg-blue-600','bg-green-600','bg-purple-600','bg-orange-600','bg-pink-600','bg-teal-600'].map((c,i)=>(<div key={i} className="aspect-video rounded-lg bg-gray-700 flex items-center justify-center"><div className={'w-10 h-10 rounded-full '+c+' flex items-center justify-center text-white font-bold text-sm'}>{['JD','MK','AL','SR','PN','TC'][i]}</div></div>))}</div>
            <div className="mt-3 flex justify-center gap-3">{[Mic,Camera,Monitor].map((Ic,i)=><div key={i} className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center"><Ic className="w-4 h-4 text-white"/></div>)}<div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center"><div className="w-4 h-0.5 bg-white"/></div></div>
          </div>
        </div>
      </section>
      <section id="features" className="py-20 px-6">
        <div className="max-w-7xl mx-auto text-center mb-16"><h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">Everything you need</h2></div>
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[{icon:Users,t:'500 Participants',d:'Scale without limits'},{icon:Shield,t:'E2E Encryption',d:'AES-256 secured'},{icon:MessageSquare,t:'Real-time Chat',d:'With reactions'},{icon:Monitor,t:'HD Screen Share',d:'Full HD quality'},{icon:Hand,t:'Hand Raising',d:'Queue-based Q&A'},{icon:Smile,t:'AI Captions',d:'40+ languages'}].map((f,i)=>(
            <div key={i} className="card p-6 hover:scale-[1.02] transition-transform"><h3 className="font-semibold text-gray-900 mb-2">{f.t}</h3><p className="text-sm text-gray-600">{f.d}</p></div>
          ))}
        </div>
      </section>
      <section id="pricing" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto text-center mb-16"><h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">Simple pricing</h2></div>
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          <div className="card p-8"><h3 className="text-xl font-semibold mb-2">Free</h3><div className="mb-6"><span className="text-4xl font-bold"></span><span className="text-gray-500">/mo</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>50 participants</li><li>60 min meetings</li><li>HD video</li></ul><button onClick={start} className="btn-secondary w-full">Get started</button></div>
          <div className="card p-8 border-2 border-[#1a73e8] relative"><div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1a73e8] text-white text-xs font-semibold px-3 py-1 rounded-full">Popular</div><h3 className="text-xl font-semibold mb-2">Pro</h3><div className="mb-6"><span className="text-4xl font-bold"></span><span className="text-gray-500">/user/mo</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>200 participants</li><li>Unlimited duration</li><li>AI captions</li></ul><button onClick={start} className="btn-primary w-full">Start trial</button></div>
          <div className="card p-8"><h3 className="text-xl font-semibold mb-2">Enterprise</h3><div className="mb-6"><span className="text-4xl font-bold">Custom</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>500 participants</li><li>Unlimited</li><li>Custom integrations</li></ul><button className="btn-secondary w-full">Contact sales</button></div>
        </div>
      </section>
      <footer className="border-t border-gray-100 py-12 px-6 text-center"><p className="text-sm text-gray-400">© 2026 LeTsMeet. All rights reserved.</p></footer>
      {showJoinModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowJoinModal(false)}><div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl" onClick={e=>e.stopPropagation()}><h3 className="text-xl font-bold mb-2">Join a meeting</h3><input type="text" placeholder="Meeting code" value={meetingCode} onChange={e=>setMeetingCode(e.target.value)} className="input-field mb-4" onKeyDown={e=>e.key==='Enter'&&join()}/><div className="flex gap-3"><button onClick={()=>setShowJoinModal(false)} className="btn-secondary flex-1">Cancel</button><button onClick={join} className="btn-primary flex-1">Join</button></div></div></div>)}
    </div>
  );
}
