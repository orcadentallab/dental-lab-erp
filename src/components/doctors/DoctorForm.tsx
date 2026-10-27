import { useState } from 'react';
import { db } from '../../services/db';
import { DOCTOR_CODE_REGIONS, normalizeDoctorName } from '../../lib/doctorIdentity';

interface DoctorFormProps {
    onSuccess?: () => void;
}

export default function DoctorForm({ onSuccess }: DoctorFormProps) {
    // Load initial state from localStorage if available
    const [name, setName] = useState(() => localStorage.getItem('doctorForm_name') || '');
    const [phone, setPhone] = useState(() => localStorage.getItem('doctorForm_phone') || '');
    const [phone2, setPhone2] = useState(() => localStorage.getItem('doctorForm_phone2') || '');
    const [address, setAddress] = useState(() => localStorage.getItem('doctorForm_address') || '');
    const [codeRegion, setCodeRegion] = useState(() => localStorage.getItem('doctorForm_codeRegion') || '');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Persist changes
    const handleChange = (key: string, value: string, setter: (v: string) => void) => {
        setter(value);
        localStorage.setItem(`doctorForm_${key}`, value);
    };

    const clearForm = () => {
        setName('');
        setPhone('');
        setPhone2('');
        setAddress('');
        setCodeRegion('');

        localStorage.removeItem('doctorForm_name');
        localStorage.removeItem('doctorForm_phone');
        localStorage.removeItem('doctorForm_phone2');
        localStorage.removeItem('doctorForm_address');
        localStorage.removeItem('doctorForm_doctorCode');
        localStorage.removeItem('doctorForm_codeRegion');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            await db.addDoctor({
                name: normalizeDoctorName(name),
                phone,
                phone2: phone2 || undefined,
                address,
                doctorCode: '',
                codeRegion: DOCTOR_CODE_REGIONS.find(region => region.value === codeRegion)?.value,
                representativeName: '' // Optional field
            });

            clearForm();

            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error adding doctor:', error);
            alert('حدث خطأ أثناء إضافة الطبيب');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    اسم الطبيب *
                </label>
                <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleChange('name', e.target.value, setName)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="د. أحمد محمد"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    الهاتف *
                </label>
                <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => handleChange('phone', e.target.value, setPhone)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="01234567890"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    هاتف 2 (اختياري)
                </label>
                <input
                    type="tel"
                    value={phone2}
                    onChange={(e) => handleChange('phone2', e.target.value, setPhone2)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="01234567890"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    منطقة العيادة الرئيسية *
                </label>
                <select required aria-label="منطقة العيادة الرئيسية" value={codeRegion} onChange={event => handleChange('codeRegion', event.target.value, setCodeRegion)} className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700">
                    <option value="">اختر المنطقة</option>
                    {DOCTOR_CODE_REGIONS.map(region => <option key={region.value} value={region.value}>{region.label}</option>)}
                </select>
                <p className="text-xs text-gray-500">الكود يتولد تلقائيًا عند الحفظ.</p>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    العنوان *
                </label>
                <textarea
                    required
                    value={address}
                    onChange={(e) => handleChange('address', e.target.value, setAddress)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    rows={3}
                    placeholder="القاهرة، مصر"
                />
            </div>

            <div className="flex gap-2 pt-4">
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
                >
                    {isSubmitting ? 'جاري الحفظ...' : 'حفظ'}
                </button>
            </div>
        </form>
    );
}
