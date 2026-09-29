import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { getApiErrorMessage } from '../api/client';
import { starterApi, type PublishInput, type StarterRun, type StarterRunSummary } from '../api/starterApi';
import { useToast } from '../context/ToastContext';
import { PageHeader } from '../components/common/PageHeader';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { RunList } from '../components/starter/RunList';
import { ChatPane } from '../components/starter/ChatPane';
import { ProjectPane, type ProjectTab } from '../components/starter/ProjectPane';
import { POLL_MS, isBusy, isNoAiError } from '../components/starter/starterMeta';

export const StarterPage: React.FC = () => {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('run');

  const [showAll, setShowAll] = useState(false);
  const [runs, setRuns] = useState<StarterRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [run, setRun] = useState<StarterRun | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [noAi, setNoAi] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<ProjectTab>('tracker');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadRuns = useCallback(() => {
    setRunsLoading(true);
    return starterApi
      .runs(showAll)
      .then(setRuns)
      .catch((err) => toast.error(getApiErrorMessage(err, 'Could not load projects')))
      .finally(() => setRunsLoading(false));
  }, [showAll, toast]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Load the selected run (kept when it is the one we already have, e.g. right after creating it).
  useEffect(() => {
    if (!selectedId) {
      setRun(null);
      return;
    }
    let alive = true;
    setRun((prev) => (prev && prev._id === selectedId ? prev : null));
    starterApi
      .run(selectedId)
      .then((r) => alive && setRun(r))
      .catch((err) => {
        if (!alive) return;
        toast.error(getApiErrorMessage(err, 'Could not load the project'));
        setSearchParams({}, { replace: true });
      });
    return () => {
      alive = false;
    };
  }, [selectedId, setSearchParams, toast]);

  // Poll while the server generates files or publishes.
  useEffect(() => {
    if (!run || !isBusy(run.status)) return;
    const prevStatus = run.status;
    const timer = window.setTimeout(() => {
      starterApi
        .run(run._id)
        .then((next) => {
          setRun((cur) => (cur && cur._id === next._id ? next : cur));
          if (next.status === prevStatus) return;
          void loadRuns();
          if (next.status === 'ready' && prevStatus === 'generating') {
            toast.success(`Generated ${next.files.length} files. Review them, then push.`);
            setTab('files');
          } else if (next.status === 'published') {
            toast.success(`Pushed to ${next.repo?.fullName || 'the new repository'}`);
            setTab('push');
          } else if (next.status === 'failed') {
            toast.error(next.error || 'The step failed. See the Tracker for details.');
            setTab('tracker');
          }
        })
        .catch(() => setRun((cur) => (cur ? { ...cur } : cur))); // retry on the next tick
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [run, loadRuns, toast]);

  const handleAiError = (err: unknown, fallback: string) => {
    const message = getApiErrorMessage(err, fallback);
    if (isNoAiError(message)) setNoAi(true);
    return message;
  };

  const send = async (text: string): Promise<boolean> => {
    setPending(text);
    setChatError(null);
    try {
      if (run) {
        setRun(await starterApi.send(run._id, text));
      } else {
        const created = await starterApi.create({ message: text });
        setRun(created);
        setSearchParams({ run: created._id });
      }
      void loadRuns();
      return true;
    } catch (err) {
      setChatError(handleAiError(err, 'The AI did not answer. Try again.'));
      return false;
    } finally {
      setPending(null);
    }
  };

  const generate = async () => {
    if (!run) return;
    setGenerating(true);
    try {
      const res = await starterApi.generate(run._id);
      setRun(res.run);
      setTab('tracker');
      void loadRuns();
    } catch (err) {
      toast.error(handleAiError(err, 'Could not start generating'));
    } finally {
      setGenerating(false);
    }
  };

  const saveFile = async (path: string, content: string) => {
    if (!run) return false;
    try {
      setRun(await starterApi.saveFile(run._id, path, content));
      toast.success(`Saved ${path}`);
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save the file'));
      return false;
    }
  };

  const deleteFile = async (path: string) => {
    if (!run) return false;
    try {
      setRun(await starterApi.deleteFile(run._id, path));
      toast.success(`Deleted ${path}`);
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not delete the file'));
      return false;
    }
  };

  const publish = async (input: PublishInput): Promise<string | null> => {
    if (!run) return 'No project selected';
    try {
      const res = await starterApi.publish(run._id, input);
      setRun(res.run);
      setTab('tracker');
      toast.info(res.message || 'Creating the repository…');
      void loadRuns();
      return null;
    } catch (err) {
      return getApiErrorMessage(err, 'Could not create the repository');
    }
  };

  const removeRun = async () => {
    if (!run) return;
    setDeleting(true);
    try {
      await starterApi.remove(run._id);
      toast.success('Project deleted');
      setDeleteOpen(false);
      setRun(null);
      setSearchParams({});
      void loadRuns();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not delete the project'));
    } finally {
      setDeleting(false);
    }
  };

  const startNew = () => {
    setSearchParams({});
    setRun(null);
    setChatError(null);
    setTab('tracker');
  };

  const select = (id: string) => {
    if (id === selectedId) return;
    setChatError(null);
    setTab('tracker');
    setSearchParams({ run: id });
  };

  return (
    <div>
      <PageHeader
        title="Project Starter"
        description="Describe a new project; the AI asks what it needs, generates the files with the latest package versions, and pushes them to a new GitHub or GitLab repository."
        badge={
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-700 text-[10px] font-semibold">
            <Sparkles size={10} /> AI
          </span>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4">
        <RunList
          runs={runs}
          loading={runsLoading}
          selectedId={selectedId}
          showAll={showAll}
          onToggleAll={setShowAll}
          onSelect={select}
          onNew={startNew}
        />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 min-w-0">
          <ChatPane
            key={selectedId || 'new'}
            run={run}
            pending={pending}
            error={chatError}
            noAi={noAi}
            generating={generating}
            onSend={send}
            onGenerate={generate}
          />
          <ProjectPane
            run={run}
            tab={tab}
            onTabChange={setTab}
            onSaveFile={saveFile}
            onDeleteFile={deleteFile}
            onPublish={publish}
            onDeleteRun={() => setDeleteOpen(true)}
          />
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete project?"
        message={
          <>
            Deletes <span className="font-semibold">{run?.title || 'this project'}</span>, its conversation and generated files.
            {run?.repo && ' The repository on ' + (run.repo.provider === 'gitlab' ? 'GitLab' : 'GitHub') + ' is kept.'}
          </>
        }
        confirmLabel="Delete project"
        isLoading={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void removeRun()}
      />
    </div>
  );
};

export default StarterPage;
