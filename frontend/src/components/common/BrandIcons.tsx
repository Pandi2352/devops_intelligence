import React from 'react';
import { GitLabLogo } from '../connectors/ConnectorLogos';

interface BrandIconProps {
  size?: number;
  className?: string;
}

// Renders the shared assets/connectors/gitlab.svg so every GitLab logo in the app is identical.
export const GitLabIcon: React.FC<BrandIconProps> = ({ size = 28, className = '' }) => (
  <GitLabLogo size={size} className={className} />
);

/**
 * Official Kubernetes Helm Wheel Vector Icon
 */
export const KubernetesIcon: React.FC<BrandIconProps> = ({ size = 28, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Outer polygon */}
    <path
      d="M12 2L3.5 6.9v10.2L12 22l8.5-4.9V6.9L12 2z"
      fill="#326CE5"
    />
    {/* Inner wheel ring */}
    <circle cx="12" cy="12" r="5.6" stroke="#FFFFFF" strokeWidth="1.6" fill="none" />
    <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
    {/* Spokes */}
    <path
      d="M12 6.4v-3M12 17.6v3M6.8 9l-2.6-1.5M17.2 15l2.6 1.5M6.8 15l-2.6 1.5M17.2 9l2.6-1.5"
      stroke="#FFFFFF"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Official ArgoCD GitOps Engine Vector Icon
 */
export const ArgoCDIcon: React.FC<BrandIconProps> = ({ size = 28, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect width="24" height="24" rx="5" fill="#EF6C00" fillOpacity="0.08" />
    {/* Octopus head */}
    <path
      d="M12 4C7.8 4 4.5 7.3 4.5 11.5c0 2.6 1.3 4.9 3.3 6.3.3.2.7.1.8-.2l.6-2.4c.1-.3-.1-.6-.4-.7A5.4 5.4 0 017 11.5c0-2.8 2.2-5 5-5s5 2.2 5 5c0 1.1-.3 2.1-.9 2.9-.2.3-.1.6.1.8l1.3 2.2c.2.3.6.4.9.1A7.4 7.4 0 0019.5 11.5C19.5 7.3 16.2 4 12 4z"
      fill="#EF6C00"
    />
    {/* Eyes */}
    <circle cx="9.8" cy="11.2" r="1.3" fill="#EF6C00" />
    <circle cx="14.2" cy="11.2" r="1.3" fill="#EF6C00" />
    <circle cx="10" cy="11" r="0.5" fill="#FFFFFF" />
    <circle cx="14.4" cy="11" r="0.5" fill="#FFFFFF" />
    {/* Smile */}
    <path
      d="M10.2 14.2c.5.5 1.1.8 1.8.8s1.3-.3 1.8-.8"
      stroke="#EF6C00"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * GitHub Octocat Vector Icon
 */
export const GitHubIcon: React.FC<BrandIconProps> = ({ size = 28, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
    />
  </svg>
);
