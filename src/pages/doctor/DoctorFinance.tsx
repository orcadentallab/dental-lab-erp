import { useDoctorLanguage } from '../../context/DoctorLanguageContext';
import { formatDoctorText } from '../../translations/doctorPortal';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { PortalError, PortalSkeleton } from '../../components/doctors/PortalStates';
import { Card } from '../../components/ui/Card';
import { doctorPortalService, type PortalMonth } from '../../services/doctorPortalService';

export default function DoctorFinance() {
    const { t, locale } = useDoctorLanguage();
    const [previous, setPrevious] = useState(false);
    const [loadVersion, setLoadVersion] = useState(0);
    const [month, setMonth] = useState<PortalMonth | null>(null);
    const [error, setError] = useState<'loadFinanceError' | ''>('');

    useEffect(() => {
        let active = true;
        doctorPortalService.month(previous)
            .then(data => { if (active) setMonth(data); })
            .catch(() => { if (active) setError('loadFinanceError'); });
        return () => { active = false; };
    }, [previous, loadVersion]);

    const money = (value: number) => formatDoctorText(t.money, Number(value).toLocaleString(locale));
    const summary = month ? [
        { label: t.recordedCases, value: month.charges, icon: Wallet, tone: 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800' },
        { label: t.recordedPayments, value: month.payments, icon: ArrowDownLeft, tone: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' },
        { label: t.adjustments, value: month.adjustments, icon: ArrowUpRight, tone: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' },
        { label: t.monthlyDifference, value: month.difference, icon: Scale, tone: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40' },
    ] : [];

    return (
        <div className="portal-page max-w-4xl">
            <div>
                <h1 className="portal-title">{t.monthlyAccount}</h1>
                <p className="portal-muted">
                    {t.monthlyIntro}
                </p>
            </div>

            <div className="inline-flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1" role="group" aria-label={t.chooseMonth}>
                {[false, true].map(value => (
                    <button
                        type="button"
                        key={String(value)}
                        aria-pressed={previous === value}
                        onClick={() => { if (previous !== value) { setMonth(null); setError(''); setPrevious(value); } }}
                        className={`min-h-[44px] px-5 rounded-xl text-sm font-bold transition-all ${previous === value ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-700 dark:text-slate-300'}`}
                    >
                        {value ? t.previousMonth : t.currentMonth}
                    </button>
                ))}
            </div>

            {error && <PortalError message={t[error]} retry={() => { setError(''); setLoadVersion(value => value + 1); }} />}
            {!month && !error && <PortalSkeleton label={t.loadingAccount} />}

            {month && (
                <>
                    <h2 className="font-bold text-slate-800 dark:text-slate-100">
                        {new Date(`${month.month}T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {summary.map(({ label, value, icon: Icon, tone }) => (
                            <Card initial={false} key={label} className="portal-card">
                                <span className={`inline-flex p-2 rounded-xl ${tone}`}><Icon className="rtl:-scale-x-100" size={16} /></span>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">{label}</p>
                                <p className="text-lg font-black mt-1 text-slate-900 dark:text-white">{money(Number(value))}</p>
                            </Card>
                        ))}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        {t.monthlyScope}
                    </p>

                    {month.is_center && (
                        <Card initial={false} className="portal-card space-y-2">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{t.chargesByDentist}</h3>
                            {month.by_doctor.map(row => (
                                <p key={row.id} className="flex flex-wrap justify-between gap-2 text-sm border-t border-slate-100 dark:border-slate-800 pt-2">
                                    <span className="font-bold">{row.name}</span>
                                    <span className="text-slate-600 dark:text-slate-300">{t.caseCharges} {money(row.amount)} {t.casePayments} {money(row.paid)}</span>
                                </p>
                            ))}
                        </Card>
                    )}

                    <section className="space-y-3">
                        <h3 className="font-bold text-slate-800 dark:text-slate-100">{t.monthlyCases}</h3>
                        {month.cases.length ? month.cases.map((item, i) => (
                            <Card initial={false} key={`${item.case_id}-${i}`} className="portal-card flex flex-wrap gap-3 justify-between items-center">
                                <div>
                                    <p className="font-bold text-slate-900 dark:text-white">{item.patient_name}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        <bdi dir="ltr">{item.case_id}</bdi>{month.is_center && ` — ${item.doctor_name}`}
                                    </p>
                                </div>
                                <p className="font-black text-slate-900 dark:text-white">{money(item.amount)}</p>
                            </Card>
                        )) : (
                            <Card initial={false} className="portal-card space-y-2 text-center">
                                <p className="font-semibold">{t.noMonthlyCases}</p>
                                <p className="portal-muted">{t.monthEmptyHelp}</p>
                                <Link to="/doctor/support" className="portal-primary">{t.accountInquiry}</Link>
                            </Card>
                        )}
                    </section>
                </>
            )}

            {!!month?.cases.length && <Link to="/doctor/support" className="portal-primary">{t.accountInquiry}</Link>}
        </div>
    );
}
