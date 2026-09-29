import api from './client';
import { User, UserRole } from '../types';

export const authApi = {
  getMe: async (): Promise<User> => {
    const res = await api.get('/auth/me');
    return res.data.user;
  },
  getUsers: async (): Promise<User[]> => {
    const res = await api.get('/auth/users');
    return res.data.users;
  },
  updateUserRole: async (
    id: string,
    data: { role?: UserRole; allowedClusters?: string[]; allowedEnvironments?: string[]; isActive?: boolean }
  ): Promise<User> => {
    const res = await api.put(`/auth/users/${id}/role`, data);
    return res.data.user;
  },
};
