import { useState } from 'react';
import { db } from '../../services/db';

interface DoctorFormProps {
    onSuccess?: () => void;
}

export default function DoctorForm({ onSuccess }: DoctorFormProps) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [phone2, setPhone2] = useState('');
    const [address, setAddress] = useState('');
    const [doctorCode, setDoctorCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            await db.addDoctor({
                name,
                phone,
                phone2: phone2 || undefined,
                address,
                doctorCode: doctorCode.trim().toUpperCase(),
                representativeName: '' // Optional field
            });

            // Reset form
            setName('');
            setPhone('');
            setPhone2('');
            setAddress('');
            setDoctorCode('');

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
                    onChange={(e) => setName(e.target.value)}
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
                    onChange={(e) => setPhone(e.target.value)}
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
                    onChange={(e) => setPhone2(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="01234567890"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    كود الطبيب *
                </label>
                <input
                    type="text"
                    required
                    value={doctorCode}
                    onChange={(e) => setDoctorCode(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white uppercase"
                    placeholder="AHM"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    العنوان *
                </label>
                <textarea
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
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
