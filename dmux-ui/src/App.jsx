import { Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/Toasts';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import ProjectsGrid from './pages/ProjectsGrid';
import ProjectDetail from './pages/ProjectDetail';
import AgentSession from './pages/AgentSession';
import RunDetail from './pages/RunDetail';
import Skills from './pages/Skills';

export default function App() {
  return (
    <ToastProvider>
      <a href="#main" className="visually-hidden">Skip to main content</a>
      <Navbar />
      <main id="main" style={{ flex: 1, padding: '24px 32px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectsGrid />} />
          <Route path="/projects/:name" element={<ProjectDetail />} />
          <Route path="/projects/:name/agents" element={<AgentSession />} />
          <Route path="/projects/:name/runs/:runId" element={<RunDetail />} />
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </main>
    </ToastProvider>
  );
}
