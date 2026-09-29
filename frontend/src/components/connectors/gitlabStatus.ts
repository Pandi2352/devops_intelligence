import { GitIntegration } from '../../types';

// Disabled connectors report "Disabled" regardless of their last test result.
export const gitlabStatus = (g: GitIntegration): string => (g.isActive ? g.status || 'Unknown' : 'Disabled');
