import React, { forwardRef } from 'react';
import { twMerge } from 'tailwind-merge';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, label, error, icon, ...props }, ref) => {
        return (
            <div className="w-full">
                {label && (
                    <label className="block text-sm font-medium text-surface-700 mb-1.5 ml-1">
                        {label}
                    </label>
                )}
                <div className="relative">
                    {icon && (
                        <div className="absolute top-1/2 -translate-y-1/2 right-3 text-surface-400 pointer-events-none">
                            {icon}
                        </div>
                    )}
                    <input
                        className={twMerge(
                            'w-full py-2.5 bg-surface-50 border border-surface-200 rounded-xl',
                            'transition-all duration-200',
                            'focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 focus:bg-white focus:outline-none',
                            'placeholder:text-surface-400 text-surface-900',
                            icon ? 'pr-10 pl-4' : 'px-4',
                            error && 'border-red-300 focus:border-red-500 focus:ring-red-200',
                            className
                        )}
                        ref={ref}
                        {...props}
                    />
                </div>
                {error && (
                    <p className="mt-1 text-sm text-red-500 animate-slide-in-right">
                        {error}
                    </p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';
