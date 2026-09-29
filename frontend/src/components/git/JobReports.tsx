import React, { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { gitApi, JobArtifacts } from '../../api/gitApi';
import { getApiErrorMessage } from '../../api/client';

interface JobReportsProps {
  integrationId: string;
  repoId: string | number;
  jobId: number | string;
}

const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Files a job saved as artifacts (e.g. trivy-report.txt, npm-audit.txt, kube-config.yaml).
export const JobReports: React.FC<JobReportsProps> = ({ integrationId, repoId, jobId }) => {
  const [data, setData] = useState<JobArtifacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    gitApi
      .getJobArtifacts(integrationId, repoId, jobId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSelected(res.files.find((f) => f.content !== undefined)?.path || res.files[0]?.path || null);
      })
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, 'Could not load the job reports')));
    return () => {
      cancelled = true;
    };
  }, [integrationId, repoId, jobId]);

  if (error) {
    return <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-xs">{error}</div>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 p-4 text-xs text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Loading reports…
      </div>
    );
  }
  if (data.files.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-md">
        {data.expired
          ? 'The artifacts of this job have expired.'
          : data.tooLarge
          ? 'The artifacts are too large to preview. Download them from GitLab.'
          : 'This job did not save any report files.'}
        {data.tooLarge && data.downloadUrl && (
          <a href={data.downloadUrl} target="_blank" rel="noreferrer" className="block mt-2 text-sky-700 font-semibold hover:underline">
            Download artifacts
          </a>
        )}
      </div>
    );
  }

  const file = data.files.find((f) => f.path === selected);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] gap-3">
      <ul className="space-y-1" aria-label="Report files">
        {data.files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => setSelected(f.path)}
              aria-current={f.path === selected}
              className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-md border text-left text-xs cursor-pointer ${
                f.path === selected ? 'border-sky-500 bg-sky-50 text-sky-900' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <FileText size={14} className="shrink-0 mt-0.5 text-slate-400" aria-hidden />
              <span className="min-w-0">
                <span className="block font-mono truncate" title={f.path}>
                  {f.path}
                </span>
                <span className="block text-[10px] text-slate-500">{formatSize(f.size)}</span>
              </span>
            </button>
          </li>
        ))}
        {data.downloadUrl && (
          <li>
            <a href={data.downloadUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-sky-700 hover:underline">
              <Download size={12} aria-hidden /> Download all
            </a>
          </li>
        )}
      </ul>

      <div className="min-w-0">
        {file?.content !== undefined ? (
          <>
            <pre className="h-[50vh] overflow-auto rounded-md bg-slate-950 border border-slate-800 p-3 font-mono text-[11px] leading-5 text-slate-200 whitespace-pre custom-scrollbar">
              {file.content || '(empty file)'}
            </pre>
            {file.truncated && <p className="mt-1 text-[11px] text-amber-700">Showing the first 512 KB. Download for the full file.</p>}
          </>
        ) : (
          <div className="h-full min-h-32 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-md">
            Binary file: download it to view.
          </div>
        )}
      </div>
    </div>
  );
};
