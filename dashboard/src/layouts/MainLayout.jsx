import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Sidebar from '../components/Sidebar';
import MailModal from '../components/MailModal';
import { JarvisContext } from '../contexts/JarvisContext';
import { useJarvisData } from '../hooks/useJarvisData';

export default function MainLayout() {
  const jarvis = useJarvisData();
  const [searchThread, setSearchThread] = useState(null);

  return (
    <JarvisContext.Provider value={jarvis}>
      <div className="app-shell">
        <Sidebar metrics={jarvis.threadMetrics} />
        <div className="app-main">
          <Topbar
            lastRefresh={jarvis.lastRefresh}
            onRefreshed={jarvis.refresh}
            onOpenThread={setSearchThread}
          />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Modal opened from global search — available on any page */}
      {searchThread && (
        <MailModal
          thread={searchThread}
          onClose={() => setSearchThread(null)}
          onTransition={(tid, estado, note) => {
            setSearchThread(null);
            jarvis.refreshThreads();
          }}
          onSpam={() => { setSearchThread(null); jarvis.refreshThreads(); }}
          isInformativo={searchThread.estado === 'informativo'}
        />
      )}
    </JarvisContext.Provider>
  );
}
