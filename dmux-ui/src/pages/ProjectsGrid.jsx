import { useState, useEffect } from 'react';
import ProjectCard from '../components/ProjectCard';
import styles from './ProjectsGrid.module.css';

export default function ProjectsGrid() {
  const [projects, setProjects] = useState([]);
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
        <button className={styles.addBtn} onClick={() => setShowAdd(true)}>
          Add Project
        </button>
      </div>

      {projects.length > 0 ? (
        <div className={styles.grid}>
          {projects.map((p) => (
            <ProjectCard key={p.name} project={p} />
          ))}
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
