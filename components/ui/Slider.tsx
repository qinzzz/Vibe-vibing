import React from 'react';

interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    desc: string;
    onChange: (value: number) => void;
}

export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step, desc, onChange }) => (
    <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center">
            <label className="text-white/80 text-[11px] font-medium">{label}</label>
            <span className="text-blue-400 font-mono text-[10px]">{value.toFixed(2)}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full accent-blue-500 bg-white/10 rounded-lg h-1 appearance-none cursor-pointer"
        />
        <p className="text-white/40 text-[9px] italic leading-tight">{desc}</p>
    </div>
);
