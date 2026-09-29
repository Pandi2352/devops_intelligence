export const formatRelativeTime = (iso?: string): string => {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${Math.max(1, diffMin)}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatDateTime = (iso?: string): string =>
  iso ? new Date(iso).toLocaleString() : 'Never';

export const hostFromUrl = (value?: string): string => {
  if (!value) return '';
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
};
