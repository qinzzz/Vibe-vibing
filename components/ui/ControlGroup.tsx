import React from 'react';

export const ControlGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-6">
    <h3 className="text-blue-400 text-[10px] font-bold uppercase tracking-widest mb-3 border-b border-blue-400/20 pb-1">{title}</h3>
    <div className="space-y-4">{children}</div>
  </div>
);
