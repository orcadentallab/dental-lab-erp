import { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Trash, Save, Coins, Building } from 'lucide-react';
import { financeService, type CapitalEntry, type FixedAsset } from '../../services/financeService';
import { useAuth } from '../../context/AuthContext';

export default function FinancialSetup() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';

    const [capitalEntries, setCapitalEntries] = useState<CapitalEntry[]>([]);
    const [fixedAssets, setFixedAssets] = useState<FixedAsset[]>([]);
    // const [loading, setLoading] = useState(true);

    // New Entry States
    const [newCapital, setNewCapital] = useState({ source: '', amount: '', date: new Date().toISOString().split('T')[0], notes: '' });
    const [newAsset, setNewAsset] = useState({ name: '', value: '', purchase_date: new Date().toISOString().split('T')[0], notes: '' });

    useEffect(() => {
        if (isAdmin) loadData();
    }, [isAdmin]);

    if (!isAdmin) return <div className="p-8 text-center text-red-500">غير مصرح لك بدخول هذه الصفحة</div>;

    async function loadData() {
        // setLoading(true);
        try {
            const [params, assets] = await Promise.all([
                financeService.getCapitalEntries(),
                financeService.getFixedAssets()
            ]);
            setCapitalEntries(params);
            setFixedAssets(assets);
        } catch (e) {
            console.error(e);
        } finally {
            // setLoading(false);
        }
    }

    async function handleAddCapital(e: React.FormEvent) {
        e.preventDefault();
        try {
            await financeService.addCapitalEntry({
                source: newCapital.source,
                amount: parseFloat(newCapital.amount),
                date: newCapital.date,
                notes: newCapital.notes
            });
            setNewCapital({ source: '', amount: '', date: new Date().toISOString().split('T')[0], notes: '' });
            loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحفظ');
        }
    }

    async function handleAddAsset(e: React.FormEvent) {
        e.preventDefault();
        try {
            await financeService.addFixedAsset({
                name: newAsset.name,
                value: parseFloat(newAsset.value),
                purchase_date: newAsset.purchase_date,
                notes: newAsset.notes
            });
            setNewAsset({ name: '', value: '', purchase_date: new Date().toISOString().split('T')[0], notes: '' });
            loadData();
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحفظ');
        }
    }

    async function handleDeleteCapital(id: string) {
        if (!confirm('هل أنت متأكد من الحذف؟')) return;
        try {
            await financeService.deleteCapitalEntry(id);
            loadData();
        } catch (error) {
            console.error(error);
        }
    }

    async function handleDeleteAsset(id: string) {
        if (!confirm('هل أنت متأكد من الحذف؟')) return;
        try {
            await financeService.deleteFixedAsset(id);
            loadData();
        } catch (error) {
            console.error(error);
        }
    }

    const totalCapital = capitalEntries.reduce((sum, item) => sum + item.amount, 0);
    const totalAssets = fixedAssets.reduce((sum, item) => sum + item.value, 0);
    const startCash = totalCapital - totalAssets; // Cash remaining from capital after buying assets

    return (
        <div className="space-y-8">
            {/* Summary Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
                    <div className="flex items-center gap-2 mb-2 text-indigo-800 font-bold">
                        <Coins size={20} />
                        <h3>إجمالي رأس المال</h3>
                    </div>
                    <p className="text-2xl font-black text-indigo-900">{totalCapital.toLocaleString()} <span className="text-sm">EGP</span></p>
                </Card>
                <Card className="p-6 bg-gradient-to-br from-amber-50 to-white border-amber-100">
                    <div className="flex items-center gap-2 mb-2 text-amber-800 font-bold">
                        <Building size={20} />
                        <h3>إجمالي الأصول الثابتة</h3>
                    </div>
                    <p className="text-2xl font-black text-amber-900">{totalAssets.toLocaleString()} <span className="text-sm">EGP</span></p>
                </Card>
                <Card className="p-6 bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
                    <div className="flex items-center gap-2 mb-2 text-emerald-800 font-bold">
                        <WalletIcon />
                        <h3>رصيد البداية (الكاش المتبقي)</h3>
                    </div>
                    <p className="text-2xl font-black text-emerald-900">{startCash.toLocaleString()} <span className="text-sm">EGP</span></p>
                    <p className="text-xs text-emerald-600 mt-1">المتبقي من رأس المال بعد شراء الأصول</p>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Capital Section */}
                <Card className="p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <PlusCircleIcon className="text-indigo-600" />
                        مصادر رأس المال
                    </h2>

                    <form onSubmit={handleAddCapital} className="bg-gray-50 p-4 rounded-xl mb-6 grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                placeholder="المصدر (مثلا: شريك 1)"
                                value={newCapital.source}
                                onChange={e => setNewCapital({ ...newCapital, source: e.target.value })}
                                required
                            />
                            <Input
                                type="number"
                                placeholder="المبلغ"
                                value={newCapital.amount}
                                onChange={e => setNewCapital({ ...newCapital, amount: e.target.value })}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                type="date"
                                value={newCapital.date}
                                onChange={e => setNewCapital({ ...newCapital, date: e.target.value })}
                                required
                            />
                            <Input
                                placeholder="ملاحظات"
                                value={newCapital.notes}
                                onChange={e => setNewCapital({ ...newCapital, notes: e.target.value })}
                            />
                        </div>
                        <Button type="submit" variant="primary" className="w-full">
                            <Save size={16} className="ml-2" /> حفظ
                        </Button>
                    </form>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {capitalEntries.map(entry => (
                            <div key={entry.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg group hover:border-indigo-200 transition-colors">
                                <div>
                                    <p className="font-bold text-gray-800">{entry.source}</p>
                                    <p className="text-xs text-gray-500">{entry.date}</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="font-mono font-bold text-indigo-600">{entry.amount.toLocaleString()}</span>
                                    <button aria-label="حذف" onClick={() => handleDeleteCapital(entry.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Trash size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                {/* Assets Section */}
                <Card className="p-6">
                    <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Building2Icon className="text-amber-600" />
                        الأصول الثابتة (التأسيس)
                    </h2>

                    <form onSubmit={handleAddAsset} className="bg-gray-50 p-4 rounded-xl mb-6 grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                placeholder="اسم الأصل (مثلا: فرن سيراميك)"
                                value={newAsset.name}
                                onChange={e => setNewAsset({ ...newAsset, name: e.target.value })}
                                required
                            />
                            <Input
                                type="number"
                                placeholder="القيمة"
                                value={newAsset.value}
                                onChange={e => setNewAsset({ ...newAsset, value: e.target.value })}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <Input
                                type="date"
                                value={newAsset.purchase_date}
                                onChange={e => setNewAsset({ ...newAsset, purchase_date: e.target.value })}
                                required
                            />
                            <Input
                                placeholder="ملاحظات"
                                value={newAsset.notes}
                                onChange={e => setNewAsset({ ...newAsset, notes: e.target.value })}
                            />
                        </div>
                        <Button type="submit" variant="primary" className="w-full bg-amber-600 hover:bg-amber-700 text-white">
                            <Save size={16} className="ml-2" /> حفظ
                        </Button>
                    </form>

                    <div className="space-y-2 max-h-[300px] overflow-y-auto">
                        {fixedAssets.map(asset => (
                            <div key={asset.id} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg group hover:border-amber-200 transition-colors">
                                <div>
                                    <p className="font-bold text-gray-800">{asset.name}</p>
                                    <p className="text-xs text-gray-500">{asset.purchase_date}</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="font-mono font-bold text-amber-600">{asset.value.toLocaleString()}</span>
                                    <button aria-label="حذف" onClick={() => handleDeleteAsset(asset.id)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Trash size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

        </div>

    );
}

function WalletIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
            <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </svg>
    )
}

function Building2Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
            <path d="M10 6h4" />
            <path d="M10 10h4" />
            <path d="M10 14h4" />
            <path d="M10 18h4" />
        </svg>
    )
}

function PlusCircleIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8" />
            <path d="M12 8v8" />
        </svg>
    )
}
