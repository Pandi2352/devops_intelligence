import mongoose from 'mongoose';

export const isValidId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.isValidObjectId(id);

export const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const normalizeUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const cleanString = (value: unknown, maxLength = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive exact-match filter used for connector name uniqueness checks.
export const nameMatch = (name: string) => new RegExp(`^${escapeRegex(name)}$`, 'i');
