import React from 'react';
import { Loader2 } from 'lucide-react';
import type { StarterStatus } from '../../api/starterApi';
import { STATUS_META } from './starterMeta';

export const StatusChip: React.FC<{ status: StarterStatus }> = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.chatting;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${meta.chip}`}>
      {meta.busy && <Loader2 size={10} className="animate-spin" aria-hidden />}
      {meta.label}
    </span>
  );
};
