import { useState, useRef, type KeyboardEvent, type ChangeEvent, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface TeethTagsInputProps {
    value: string[]; // Array of tooth identifiers
    onChange: (teeth: string[]) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    useToothChart?: boolean;
}

export function isFdiTooth(tooth: string): boolean {
    return /^[1-4][1-8]$/.test(tooth);
}

const ARCHES = [
    { label: 'الفك العلوي', sides: [{ label: 'يمين المريض', teeth: ['18','17','16','15','14','13','12','11'] }, { label: 'شمال المريض', teeth: ['21','22','23','24','25','26','27','28'] }] },
    { label: 'الفك السفلي', sides: [{ label: 'يمين المريض', teeth: ['48','47','46','45','44','43','42','41'] }, { label: 'شمال المريض', teeth: ['31','32','33','34','35','36','37','38'] }] },
];

export function TeethTagsInput({ value, onChange, placeholder = "أدخل رقم السن...", className, disabled = false, useToothChart = false }: TeethTagsInputProps) {
    const [inputValue, setInputValue] = useState('');
    const [inputError, setInputError] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const chartRef = useRef<HTMLDivElement>(null);
    const gesture = useRef<{ pointerId: number; first: string; teeth: Set<string>; x: number; y: number; distance: number } | null>(null);
    const [dragPreview, setDragPreview] = useState<string[]>([]);

    const toggleTooth = (tooth: string) => {
        setInputError(false);
        setInputValue('');
        onChange(value.includes(tooth) ? value.filter(item => item !== tooth) : [...value, tooth]);
    };

    const sweep = (event: PointerEvent<HTMLDivElement>) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        const distance = Math.hypot(dx, dy);
        current.distance += distance;
        const steps = Math.max(1, Math.ceil(distance / 6));
        const before = current.teeth.size;
        for (let index = 1; index <= steps; index++) {
            const target = document.elementFromPoint(current.x + dx * index / steps, current.y + dy * index / steps);
            const tooth = target?.closest<HTMLButtonElement>('[data-tooth]');
            if (tooth?.dataset.tooth && chartRef.current?.contains(tooth)) current.teeth.add(tooth.dataset.tooth);
        }
        current.x = event.clientX;
        current.y = event.clientY;
        if (current.teeth.size !== before) setDragPreview([...current.teeth]);
    };

    const finishSweep = (event: PointerEvent<HTMLDivElement>) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        sweep(event);
        const current = gesture.current;
        gesture.current = null;
        setDragPreview([]);
        if (current.teeth.size === 1 && current.distance < 8) { toggleTooth(current.first); return; }
        setInputError(false);
        setInputValue('');
        onChange([...new Set([...value, ...current.teeth])]);
    };

    const addTooth = (tooth: string) => {
        if (disabled) return;
        const trimmed = useToothChart ? tooth.trim().replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) % 16)) : tooth.trim();
        if (!trimmed) return;
        if (useToothChart && !isFdiTooth(trimmed)) {
            setInputError(true);
            return;
        }

        setInputError(false);
        // Avoid duplicates
        if (value.includes(trimmed)) {
            setInputValue('');
            return;
        }

        onChange([...value, trimmed]);
        setInputValue('');
    };

    const removeTooth = (index: number) => {
        if (disabled) return;
        const newTeeth = [...value];
        newTeeth.splice(index, 1);
        onChange(newTeeth);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            addTooth(inputValue);
        } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
            // Remove last tag on backspace when input is empty
            removeTooth(value.length - 1);
        }
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        setInputValue(e.target.value);
        setInputError(false);
    };

    const handleContainerClick = () => {
        if (!disabled) {
            inputRef.current?.focus();
        }
    };

    return (
        <div>
        <div
            onClick={handleContainerClick}
            className={clsx(
                "flex flex-wrap gap-1.5 items-center min-h-[38px] px-2 py-1.5 border border-surface-200 rounded-lg transition-colors",
                disabled ? "bg-surface-50 cursor-not-allowed opacity-75" : "bg-white cursor-text focus-within:ring-2 focus-within:ring-primary-500/30 focus-within:border-primary-400",
                className,
            )}
        >
            {value.map((tooth, index) => (
                <span
                    key={`${tooth}-${index}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-sm font-bold"
                >
                    {tooth}
                    {!disabled && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTooth(index);
                            }}
                            className="hover:bg-primary-200 rounded-full p-0.5 transition-colors"
                            aria-label={`Remove tooth ${tooth}`}
                        >
                            <X size={12} />
                        </button>
                    )}
                </span>
            ))}
            {!disabled && (
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    value={inputValue}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder={value.length === 0 ? placeholder : ''}
                    className="flex-1 min-w-[60px] bg-transparent outline-none text-sm font-mono placeholder:text-surface-300"
                    aria-label="Tooth number input"
                    aria-invalid={inputError}
                />
            )}
            {value.length > 0 && (
                <span className="text-[10px] text-surface-400 font-bold bg-surface-100 px-1.5 py-0.5 rounded">
                    {value.length} سن
                </span>
            )}
        </div>
        {inputError && <p role="alert" className="mt-1 text-xs font-medium text-rose-700">استخدم رقم سن من خانتين زي 11 أو 26، أو اختاره من الخريطة.</p>}
        {useToothChart && !disabled && <details className="tooth-chart mt-1.5 rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer px-2.5 py-2 text-xs font-semibold text-cyan-900">اختيار من خريطة الأسنان</summary>
            <div className="border-t border-slate-100 bg-slate-50 p-2">
                <div dir="ltr" className="flex justify-between px-1 text-[10px] font-semibold text-slate-600"><span>يمين المريض</span><span>شمال المريض</span></div>
                <div ref={chartRef} onPointerMove={sweep} onPointerUp={finishSweep}
                    onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) { gesture.current = null; setDragPreview([]); } }}
                    className="relative isolate mx-auto h-48 max-w-md select-none rounded-[45%] border border-rose-200 bg-rose-50/70">
                    <div aria-hidden="true" className="absolute inset-x-[12%] inset-y-[18%] rounded-[45%] border border-rose-100 bg-white/70" />
                    {ARCHES.map((arch, archIndex) => <div key={arch.label} role="group" aria-label={arch.label} className="absolute inset-0">
                        <span className={`absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-600 ${archIndex === 0 ? 'top-[39%]' : 'bottom-[39%]'}`}>{arch.label}</span>
                        {arch.sides.flatMap(side => side.teeth).map((tooth, index) => {
                            const sideDistance = Math.abs(index - 7.5) / 7.5;
                            const y = 13 + 23 * sideDistance ** 1.7;
                            return <button key={tooth} type="button" data-tooth={tooth} aria-label={`سن ${tooth}`} aria-pressed={value.includes(tooth) || dragPreview.includes(tooth)}
                                onPointerDown={event => {
                                    if (!event.isPrimary || event.button !== 0 || !chartRef.current) return;
                                    gesture.current = { pointerId: event.pointerId, first: tooth, teeth: new Set([tooth]), x: event.clientX, y: event.clientY, distance: 0 };
                                    chartRef.current.setPointerCapture(event.pointerId);
                                }}
                                onClick={event => { if (event.detail === 0) toggleTooth(tooth); }}
                                style={{ left: `${5 + index * 6}%`, top: `${archIndex === 0 ? y : 100 - y}%` }}
                                className="absolute z-10 h-7 w-[5.8%] touch-none -translate-x-1/2 -translate-y-1/2 rounded-[38%] border border-slate-400 bg-white text-[10px] font-bold tabular-nums text-slate-800 hover:border-cyan-700 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-cyan-700 aria-pressed:border-cyan-700 aria-pressed:bg-cyan-700 aria-pressed:text-white">{tooth}</button>;
                        })}
                    </div>)}
                </div>
            </div>
        </details>}
        </div>
    );
}

