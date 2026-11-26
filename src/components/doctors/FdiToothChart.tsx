import { useLayoutEffect, useRef } from 'react';
import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { lowerTeeth, portalTeeth, upperTeeth } from '../../lib/portalCaseDraft';
import { formatDoctorText } from '../../translations/doctorPortal';

export default function FdiToothChart({ selected, onChange, disabled }: {
    selected: string[];
    onChange: (teeth: string[]) => void;
    disabled: boolean;
}) {
    const { t } = useDoctorLanguage();
    const chart = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const viewport = chart.current;
        if (viewport) viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    }, []);
    return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
        <legend className="font-semibold">{t.fdiHeading}</legend>
        <p className="portal-muted text-xs">{t.fdiInstructions}</p>
        <div ref={chart} dir="ltr" className="overflow-x-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            <div dir="ltr" className="w-max space-y-3">
                {[{ label: t.upperArch, teeth: upperTeeth }, { label: t.lowerArch, teeth: lowerTeeth }].map(({ label, teeth }) => (
                    <div key={label} role="group" aria-label={label}>
                        <p dir="auto" className="portal-muted sticky left-0 mb-1 w-fit text-xs">{label}</p>
                        <div className="flex gap-1">
                            {teeth.map((tooth, index) => <button key={tooth} type="button" aria-label={formatDoctorText(t.fdiTooth, tooth)}
                                aria-pressed={selected.includes(tooth)}
                                onClick={() => onChange(portalTeeth(selected.includes(tooth) ? selected.filter(value => value !== tooth) : [...selected, tooth]))}
                                className={'portal-chip w-11 shrink-0 justify-center px-0 tabular-nums ' + (index === 8 ? 'ms-2' : '')}>{tooth}</button>)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
        {selected.length > 0 && <div aria-label={t.selectedTeeth} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="portal-muted">{t.selectedTeeth}</span>
            {selected.map(tooth => <bdi className="rounded-lg bg-blue-50 px-2 py-1 font-bold text-blue-800 tabular-nums dark:bg-blue-950 dark:text-blue-200" key={tooth}>{tooth}</bdi>)}
        </div>}
    </fieldset>;
}
