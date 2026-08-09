import { useRoute } from './lib/router';
import { SetupPage } from './pages/SetupPage';
import { ProjectPage } from './pages/ProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';

export function App() {
  const route = useRoute();
  if (route.name === 'project') return <ProjectPage key={route.id} projectId={route.id} />;
  if (route.name === 'projects') return <ProjectsPage />;
  return <SetupPage />;
}
