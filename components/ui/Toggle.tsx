import React from 'react';

interface ToggleProps {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
}

export const Toggle: React.FC<ToggleProps> = ({ label, value, onChange }) => (
    <div className="flex items-center justify-between">
        <label className="text-white/80 text-[11px] font-medium">{label}</label>
        <button
            onClick={() => onChange(!value)}
            className={`w-10 h-5 rounded-full transition-colors relative ${value ? 'bg-blue-600' : 'bg-white/10'}`}
        >
            <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${value ? 'left-6' : 'left-1'}`} />
        </button>
    </div>
);
