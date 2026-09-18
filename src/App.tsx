import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Home from './pages/Home';
import ScheduleMeeting from './pages/ScheduleMeeting';
import Settings from './pages/Settings';
import Auth from './pages/Auth';
import Meetings from './pages/Meetings';
import MeetingDetails from './pages/MeetingDetails';

const MeetingRoom = lazy(() => import('./pages/MeetingRoom'));
const JoinMeeting = lazy(() => import('./pages/JoinMeeting'));

function PageLoader({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Loading meeting experience…</div>}>
      {children}
    </Suspense>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-12 h-12 border-4 border-[#1a73e8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/meet/:meetingCode" element={<ProtectedRoute><PageLoader><MeetingRoom /></PageLoader></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute><ScheduleMeeting /></ProtectedRoute>} />
          <Route path="/join/:meetingCode?" element={<ProtectedRoute><PageLoader><JoinMeeting /></PageLoader></ProtectedRoute>} />
          <Route path="/meetings" element={<ProtectedRoute><Meetings /></ProtectedRoute>} />
          <Route path="/meetings/:meetingId" element={<ProtectedRoute><MeetingDetails /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
