import { useHashRoute } from './hooks/useHashRoute';
import { useAuth } from './context/AuthContext';
import { canUseApp } from './utils/roles';
import { ZhishitreeMain } from './ZhishitreeMain';
import { LoginPage } from './pages/LoginPage';
import { RecordsPage } from './pages/RecordsPage';
import { KnowledgeMapPage } from './pages/KnowledgeMapPage';
import { AdminPage } from './pages/AdminPage';
import { HomePage } from './pages/HomePage';
import { PaperAnalysisPage } from './pages/PaperAnalysisPage';
import { ZhongkaoMaterialsPage } from './pages/ZhongkaoMaterialsPage';
import { PendingApprovalPage } from './pages/PendingApprovalPage';
import { Loader2 } from 'lucide-react';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-indigo-600" size={36} />
      </div>
    );
  }
  if (user && !canUseApp(user)) {
    return <PendingApprovalPage onBack={() => window.location.replace('#home')} />;
  }
  return <>{children}</>;
}

export default function AppRouter() {
  const { path, query, setPath } = useHashRoute();
  const mistakeId = query.mistake ? Number(query.mistake) : undefined;
  const openMistakeId = Number.isFinite(mistakeId) && mistakeId! > 0 ? mistakeId : undefined;

  if (path === 'login') return <LoginPage onDone={() => setPath('home')} />;

  if (path === 'home') return <HomePage onNavigate={setPath} />;

  if (path === 'admin') {
    return <AdminPage onBack={() => setPath('home')} />;
  }

  return (
    <AuthGate>
      {path === 'records' && (
        <RecordsPage
          onBack={() => setPath('home')}
          onOpenMistake={(id) => setPath('entry', { mistake: id, from: 'records' })}
        />
      )}
      {path === 'map' && <KnowledgeMapPage onBack={() => setPath('home')} />}
      {path === 'zhongkao' && <ZhongkaoMaterialsPage onBack={() => setPath('home')} />}
      {path === 'paper' && <PaperAnalysisPage onBack={() => setPath('home')} onNavigate={setPath} />}
      {path === 'entry' && (
        <ZhishitreeMain
          mistakeId={openMistakeId}
          returnTo={query.from === 'records' ? 'records' : 'home'}
          onNavigate={setPath}
          onBack={() => setPath(query.from === 'records' ? 'records' : 'home')}
        />
      )}
      {path !== 'records' &&
        path !== 'map' &&
        path !== 'zhongkao' &&
        path !== 'paper' &&
        path !== 'entry' && <HomePage onNavigate={setPath} />}
    </AuthGate>
  );
}