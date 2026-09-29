import React, { useState } from 'react';
import { CheckCircle2, Search, XCircle } from 'lucide-react';
import { getApiErrorMessage } from '../../api/client';
import { starterApi, type StarterRun, type VersionLookup } from '../../api/starterApi';
import { Button } from '../common/Button';
import { ECOSYSTEMS } from './starterMeta';

const VersionCheck: React.FC = () => {
  const [ecosystem, setEcosystem] = useState('npm');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VersionLookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await starterApi.version(ecosystem, name.trim()));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not look up that package'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <h4 className="text-xs font-semibold text-slate-700 mb-2">Check a version</h4>
      <form onSubmit={check} className="flex flex-wrap gap-2">
        <select
          value={ecosystem}
          onChange={(e) => setEcosystem(e.target.value)}
          aria-label="Ecosystem"
          className="px-2 py-1.5 rounded-md border border-slate-300 text-xs bg-white"
        >
          {ECOSYSTEMS.map((eco) => (
            <option key={eco} value={eco}>
              {eco}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Package name"
          placeholder="Package name, e.g. react"
          className="flex-1 min-w-[140px] px-2 py-1.5 rounded-md border border-slate-300 text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-100 focus:border-sky-500"
        />
        <Button type="submit" size="sm" variant="secondary" leftIcon={<Search size={13} />} isLoading={loading} disabled={!name.trim()} title={name.trim() ? undefined : 'Enter a package name'}>
          Check
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      {result && (
        <div className="mt-2 text-xs flex items-start gap-1.5">
          {result.found ? <CheckCircle2 size={13} className="text-emerald-600 mt-0.5 shrink-0" /> : <XCircle size={13} className="text-rose-600 mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <span className="font-mono text-slate-800">
              {result.name}@{result.found ? result.latest : 'not found'}
            </span>
            {result.released && <span className="text-slate-500"> · released {new Date(result.released).toLocaleDateString()}</span>}
            {result.deprecated && <p className="text-amber-700">Deprecated: {result.deprecated}</p>}
            {result.notes && <p className="text-slate-500">{result.notes}</p>}
            {result.source && <p className="text-slate-400">Source: {result.source}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export const PlanTab: React.FC<{ run: StarterRun }> = ({ run }) => {
  const plan = run.plan;
  return (
    <div className="space-y-4">
      {!plan ? (
        <p className="text-xs text-slate-500">The plan appears here after you press Generate project.</p>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{plan.name}</h3>
            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{plan.summary}</p>
          </div>
          {plan.stack.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Name</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Ecosystem</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Version</th>
                    <th className="px-2.5 py-1.5 text-left font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stack.map((s, i) => (
                    <tr key={`${s.name}-${i}`} className="border-t border-slate-100 align-top">
                      <td className="px-2.5 py-1.5 font-mono text-slate-800">{s.name}</td>
                      <td className="px-2.5 py-1.5 text-slate-600">{s.ecosystem}</td>
                      <td className="px-2.5 py-1.5 font-mono text-violet-700">{s.version}</td>
                      <td className="px-2.5 py-1.5 text-slate-600">{s.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.setupInstructions && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-1">Setup instructions</h4>
              <pre className="p-3 rounded-md bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{plan.setupInstructions}</pre>
            </div>
          )}
        </>
      )}
      <VersionCheck />
    </div>
  );
};
