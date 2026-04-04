import { useState, useEffect, useMemo } from 'react';
import ProjectCard from '../components/ProjectCard';
import styles from './ProjectsGrid.module.css';

export default function ProjectsGrid() {
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState('');

  const fetchProjects = () => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Sort: running first, then has agents config, then alphabetical
  // Filter by search term
  const filtered = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (a.hasSession !== b.hasSession) return a.hasSession ? -1 : 1;
      if (a.hasAgentsConfig !== b.hasAgentsConfig) return a.hasAgentsConfig ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects, search]);

  const handleAdd = () => {
    if (!newName.trim() || !newPath.trim()) {
      setError('Name and path are required');
      return;
    }

    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), path: newPath.trim() }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setShowAdd(false);
          setNewName('');
          setNewPath('');
          setError('');
          fetchProjects();
        }
      });
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        <div className={styles.headerRight}>
          {projects.length > 3 && (
            <input
              className={styles.search}
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
            Add Project
          </button>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className={styles.grid}>
          {filtered.map((p) => (
            <ProjectCard key={p.name} project={p} />
          ))}
        </div>
      ) : search ? (
        <div className={styles.empty}>
          <p>No projects matching "{search}"</p>
        </div>
      ) : (
        <div className={styles.empty}>
          <p>No projects configured yet.</p>
          <p className={styles.emptyHint}>dmux -a myproject ~/code/myproject</p>
        </div>
      )}

      {showAdd && (
        <div className={styles.overlay} onClick={() => setShowAdd(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Add Project</h2>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Name</label>
              <input
                className={styles.modalInput}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="myproject"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Path</label>
              <input
                className={styles.modalInput}
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="~/code/myproject"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              <span className={styles.pathHint}>Absolute path or use ~ for home directory</span>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.modalActions}>
              <button className={styles.modalCancel} onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className={styles.modalSubmit} onClick={handleAdd}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
