import React, { useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { getApiErrorMessage, getApiErrorStatus } from '../../api/client';
import { ConnectionTestResult } from '../../types';

export interface ConnectorCollection<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

export interface ConnectorTabProps<T> {
  collection: ConnectorCollection<T>;
  canManage: boolean;
}

interface Named {
  _id?: string;
  name: string;
  isDefault?: boolean;
}

interface ConnectorActionsApi<T> {
  testSaved: (id: string) => Promise<ConnectionTestResult & { connector: T }>;
  setDefault: (id: string) => Promise<unknown>;
  remove: (id: string, force: boolean) => Promise<void>;
}

type ModalState<T> = { mode: 'create' } | { mode: 'edit'; item: T } | null;

// Shared state + handlers for a connector tab: add/edit modal, test, set default, and delete with confirmation.
export function useConnectorTab<T extends Named>(collection: ConnectorCollection<T>, api: ConnectorActionsApi<T>) {
  const toast = useToast();
  const [modal, setModal] = useState<ModalState<T>>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const replaceItem = (item: T) =>
    collection.setItems((prev) => {
      const exists = prev.some((p) => p._id === item._id);
      const next = exists ? prev.map((p) => (p._id === item._id ? item : p)) : [item, ...prev];
      // Only one connector of a kind can be the default.
      return item.isDefault ? next.map((p) => (p._id === item._id ? p : { ...p, isDefault: false })) : next;
    });

  const handleSaved = (item: T, message: string, ok = true) => {
    replaceItem(item);
    setModal(null);
    if (ok) toast.success(message);
    else toast.error(message);
    collection.reload();
  };

  const handleTest = async (item: T) => {
    if (!item._id) return;
    setTestingId(item._id);
    try {
      const result = await api.testSaved(item._id);
      replaceItem(result.connector);
      if (result.ok) toast.success(`${item.name}: ${result.message}`);
      else toast.error(`${item.name}: ${result.message}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, `Could not test ${item.name}`));
    } finally {
      setTestingId(null);
    }
  };

  const handleSetDefault = async (item: T) => {
    if (!item._id) return;
    try {
      await api.setDefault(item._id);
      replaceItem({ ...item, isDefault: true });
      toast.success(`'${item.name}' is now the default`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not change the default connector'));
    }
  };

  const requestDelete = (item: T) => {
    setDeleteTarget(item);
    setDeleteError(null);
    setForceDelete(false);
  };

  const cancelDelete = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget?._id) return;
    setIsDeleting(true);
    try {
      await api.remove(deleteTarget._id, forceDelete);
      collection.setItems((prev) => prev.filter((p) => p._id !== deleteTarget._id));
      toast.success(`'${deleteTarget.name}' deleted`);
      setDeleteTarget(null);
      collection.reload();
    } catch (err) {
      // 409 = still referenced elsewhere; show why and let the user confirm again to force it.
      if (getApiErrorStatus(err) === 409) {
        setDeleteError(`${getApiErrorMessage(err)}. Deleting it will leave those mappings pointing at a missing connector.`);
        setForceDelete(true);
      } else {
        setDeleteError(getApiErrorMessage(err, 'Delete failed'));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    modal,
    openCreate: () => setModal({ mode: 'create' }),
    openEdit: (item: T) => setModal({ mode: 'edit', item }),
    closeModal: () => setModal(null),
    handleSaved,
    testingId,
    handleTest,
    handleSetDefault,
    deleteTarget,
    deleteError,
    forceDelete,
    isDeleting,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
