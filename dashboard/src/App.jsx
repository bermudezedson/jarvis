import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout   from './layouts/MainLayout';
import HomePage     from './pages/HomePage';
import MailPage     from './pages/MailPage';
import TasksPage    from './pages/TasksPage';
import SprintPage   from './pages/SprintPage';
import ClientsPage  from './pages/ClientsPage';
import RulesPage    from './pages/RulesPage';
import ConfigPage   from './pages/ConfigPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index        element={<HomePage />}   />
          <Route path="correo"   element={<MailPage />}   />
          <Route path="tareas"   element={<TasksPage />}  />
          <Route path="sprint"   element={<SprintPage />} />
          <Route path="clientes" element={<ClientsPage />}/>
          <Route path="reglas"   element={<RulesPage />}  />
          <Route path="config"   element={<ConfigPage />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
