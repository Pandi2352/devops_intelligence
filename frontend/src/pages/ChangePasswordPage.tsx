import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, KeyRound, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/common/Button';
import { FormField, SecretInput } from '../components/common/Form';

const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'An upper-case and a lower-case letter', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'A number', test: (p) => /[0-9]/.test(p) },
];

export const ChangePasswordPage: React.FC = () => {
  const { user, changePassword, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const forced = Boolean(user?.mustChangePassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const valid = RULES.every((r) => r.test(next)) && next === confirm && next !== current && current.length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      toast.success(await changePassword(current, next));
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-4 py-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-sky-50 text-sky-700">
          <KeyRound size={18} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">{forced ? 'Set your own password' : 'Change password'}</h1>
          <p className="text-xs text-slate-500">
            {forced
              ? 'Your account uses a temporary or published password. Choose a new one to continue.'
              : 'Changing it signs you out everywhere else.'}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4" noValidate>
        {error && (
          <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        <FormField id="pw-current" label="Current password" required>
          <SecretInput id="pw-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </FormField>
        <FormField id="pw-new" label="New password" required>
          <SecretInput id="pw-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </FormField>
        <ul className="space-y-1">
          {RULES.map((r) => (
            <li key={r.label} className={`text-[11px] flex items-center gap-1.5 ${r.test(next) ? 'text-emerald-700' : 'text-slate-500'}`}>
              {r.test(next) ? <Check size={12} /> : <X size={12} />} {r.label}
            </li>
          ))}
          {next && next === current && <li className="text-[11px] text-rose-700">Pick a password different from the current one</li>}
        </ul>
        <FormField id="pw-confirm" label="Repeat new password" required error={confirm && confirm !== next ? 'The passwords do not match' : undefined}>
          <SecretInput id="pw-confirm" autoComplete="new-password" value={confirm} invalid={Boolean(confirm && confirm !== next)} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <div className="flex justify-between gap-2 pt-1">
          {forced ? (
            <Button variant="ghost" onClick={() => logout()}>
              Sign out
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          )}
          <Button type="submit" isLoading={saving} disabled={!valid}>
            Save password
          </Button>
        </div>
      </form>
    </div>
  );
};
