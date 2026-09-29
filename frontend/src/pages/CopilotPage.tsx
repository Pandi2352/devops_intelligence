import React from 'react';
import { PageHeader } from '../components/common/PageHeader';
import { DevOpsCopilot } from '../components/copilot/DevOpsCopilot';

export const CopilotPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <PageHeader
        title="DevOps Knowledge Copilot"
        description="Ask questions about your project pipeline, security scanners, dynamic manifest generation, and submit approval tickets"
      />
      <DevOpsCopilot />
    </div>
  );
};
