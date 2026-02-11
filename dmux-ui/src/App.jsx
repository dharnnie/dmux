import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProjectsGrid from './pages/ProjectsGrid';
import ProjectDetail from './pages/ProjectDetail';
import AgentSession from './pages/AgentSession';

export default function App() {
  return (
    <>
      <Navbar />
      <main style={{ flex: 1, padding: '24px 32px' }}>
        <Routes>
          <Route path="/" element={<ProjectsGrid />} />
          <Route path="/projects/:name" element={<ProjectDetail />} />
          <Route path="/projects/:name/agents" element={<AgentSession />} />
        </Routes>
      </main>
    </>
  );
}
