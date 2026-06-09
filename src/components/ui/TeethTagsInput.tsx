import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

interface TeethTagsInputProps {
    value: string[]; // Array of tooth identifiers
    onChange: (teeth: string[]) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
}

export function TeethTagsInput({ value, onChange, placeholder = "أدخل رقم السن...", className, disabled = false }: TeethTagsInputProps) {
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const addTooth = (tooth: string) => {
        if (disabled) return;
        const trimmed = tooth.trim();
        if (!trimmed) return;

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
    };

    const handleContainerClick = () => {
        if (!disabled) {
            inputRef.current?.focus();
        }
    };

    return (
        <div
            onClick={handleContainerClick}
            className={clsx(
                "flex flex-wrap gap-1.5 items-center min-h-[38px] px-2 py-1.5 border border-surface-200 rounded-lg transition-colors",
                disabled ? "bg-surface-50 cursor-not-allowed opacity-75" : "bg-white cursor-text focus-within:ring-2 focus-within:ring-primary-500/30 focus-within:border-primary-400",
                className
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
                />
            )}
            {value.length > 0 && (
                <span className="text-[10px] text-surface-400 font-bold bg-surface-100 px-1.5 py-0.5 rounded">
                    {value.length} سن
                </span>
            )}
        </div>
    );
}

