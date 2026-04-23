import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronsUpDown, Search, User, Loader2 } from 'lucide-react';
import { db } from '../../services/db';
import type { Doctor } from '../../services/db';
import clsx from 'clsx';

interface DoctorSelectProps {
    value: string;
    onChange: (value: string) => void;
    error?: string;
    onlyPrimary?: boolean; // If true, only show doctors who are NOT children (parentId is null)
}

export function DoctorSelect({ value, onChange, error, onlyPrimary = false }: DoctorSelectProps) {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [doctors, setDoctors] = useState<Doctor[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Debounce search term
    const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const fetchDoctors = useCallback(async (search: string) => {
        setLoading(true);
        try {
            let data = await db.getDoctors(search);
            if (onlyPrimary) {
                data = data.filter(d => !d.parentId);
            }
            setDoctors(data);
        } catch (error) {
            console.error('Failed to fetch doctors', error);
        } finally {
            setLoading(false);
        }
    }, [onlyPrimary]);

    // Initial load (sync value)
    useEffect(() => {
        const loadInitial = async () => {
            if (value && (!selectedDoctor || selectedDoctor.id !== value)) {
                const doc = await db.getDoctor(value);
                if (doc) setSelectedDoctor(doc);
            }
        };
        loadInitial();
    }, [value, selectedDoctor]);

    // Fetch doctors on search change
    useEffect(() => {
        fetchDoctors(debouncedSearch);
    }, [debouncedSearch, fetchDoctors]);
    // Handle outside click to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (doctor: Doctor) => {
        setSelectedDoctor(doctor);
        onChange(doctor.id);
        setOpen(false);
        setSearchTerm(''); // Optional: clear search or keep it?
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className={clsx(
                    "w-full min-h-10 flex items-center justify-between px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 transition-all outline-none",
                    "focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500",
                    error ? "border-red-400 bg-red-50/30 focus:border-red-500 focus:ring-red-200" : "border-surface-200 dark:border-gray-600 hover:border-surface-300",
                    !selectedDoctor && "text-surface-500"
                )}
                aria-invalid={Boolean(error)}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    <User size={16} className={clsx("shrink-0", error ? "text-red-400" : "text-surface-400")} />
                    <span className="truncate">
                        {selectedDoctor ? `${selectedDoctor.name} ${selectedDoctor.doctorCode ? `(${selectedDoctor.doctorCode})` : ''}` : "اختر طبيب..."}
                    </span>
                </div>
                <ChevronsUpDown size={14} className="text-surface-400 shrink-0 opacity-60" />
            </button>

            {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}

            {open && (
                <div className="absolute z-50 w-full mt-1.5 bg-white dark:bg-gray-800 border border-surface-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                            <input
                                type="text"
                                className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                placeholder="بحث عن طبيب..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <div className="overflow-y-auto flex-1 p-1">
                        {loading ? (
                            <div className="flex items-center justify-center py-4 text-gray-500 text-xs">
                                <Loader2 size={16} className="animate-spin mr-2" />
                                جاري التحميل...
                            </div>
                        ) : doctors.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-xs">
                                لا يوجد نتائج
                            </div>
                        ) : (
                            doctors.map(doctor => (
                                <button
                                    key={doctor.id}
                                    type="button"
                                    onClick={() => handleSelect(doctor)}
                                    className={clsx(
                                        "w-full text-right px-3 py-2 text-sm rounded-md flex items-center justify-between group transition-colors",
                                        value === doctor.id
                                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                            : "hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                                    )}
                                >
                                    <span>{doctor.name} <span className="text-gray-400 text-xs">({doctor.doctorCode || 'بدون كود'})</span></span>
                                    {value === doctor.id && <Check size={14} className="text-blue-600" />}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
