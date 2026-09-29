import { useCallback, useMemo, useState } from 'react';

export type FormErrors<T> = Partial<Record<keyof T, string>>;

// Small form-state helper shared by connector modals: values, per-field errors, validation and dirty tracking.
export function useForm<T extends Record<string, unknown>>(
  initialValues: T,
  validate?: (values: T) => FormErrors<T>
) {
  const [initial] = useState(initialValues);
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<FormErrors<T>>({});

  const setValue = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Validates everything, or only `fields` when given (e.g. the subset needed for a connection test).
  const validateFields = useCallback(
    (fields?: (keyof T)[]): boolean => {
      const all = validate ? validate(values) : {};
      const relevant = fields
        ? (Object.fromEntries(Object.entries(all).filter(([k]) => fields.includes(k as keyof T))) as FormErrors<T>)
        : all;
      setErrors(relevant);
      return Object.keys(relevant).length === 0;
    },
    [validate, values]
  );

  const isDirty = useMemo(
    () => (Object.keys(values) as (keyof T)[]).some((key) => values[key] !== initial[key]),
    [values, initial]
  );

  const reset = useCallback((next: T = initial) => {
    setValues(next);
    setErrors({});
  }, [initial]);

  return { values, errors, setValue, setValues, setErrors, validateFields, isDirty, reset };
}

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
