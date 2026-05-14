import { Outlet } from 'react-router-dom';
import Topbar from '../components/Topbar';
import Sidebar from '../components/Sidebar';
import { JarvisContext } from '../contexts/JarvisContext';
import { useJarvisData } from '../hooks/useJarvisData';

export default function MainLayout() {
  const jarvis = useJarvisData();

  return (
    <JarvisContext.Provider value={jarvis}>
      <div className="app-shell">
        <Sidebar metrics={jarvis.threadMetrics} />
        <div className="app-main">
          <Topbar
            lastRefresh={jarvis.lastRefresh}
            onRefreshed={jarvis.refresh}
          />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
    </JarvisContext.Provider>
  );
}
