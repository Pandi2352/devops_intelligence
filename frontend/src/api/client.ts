import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('kubeorbit_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Extracts the most useful message from an API error for display in the UI.
export const getApiErrorMessage = (err: unknown, fallback = 'Something went wrong'): string => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    if (err.response?.status === 403) return 'You do not have permission to perform this action.';
    if (!err.response) return 'Unable to reach the KubeOrbit API. Check that the backend is running.';
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
};

export const getApiErrorStatus = (err: unknown): number | undefined =>
  axios.isAxiosError(err) ? err.response?.status : undefined;

export default api;
