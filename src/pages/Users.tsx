import { useState, useEffect } from 'react';
import { db, type User, type Supplier } from '../services/db';
import { Plus, Trash2, Edit2, User as UserIcon, Shield } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { ErrorHandler } from '../lib/errorHandler';
import { useAuth } from '../context/AuthContext';

export default function Users() {
    const [users, setUsers] = useState<User[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { user: currentUser } = useAuth();
    const isSuperAdmin = currentUser?.username === 'admin'; // Only 'admin' can add/delete users
    const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; userId: string | null; userName: string }>({
        isOpen: false,
        userId: null,
        userName: ''
    });

    // Form State
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState(''); // Only for creating new users
    const [role, setRole] = useState<'admin' | 'lab' | 'representative' | 'accountant' | 'designer'>('lab');
    const [entityId, setEntityId] = useState(''); // For linking to Supplier
    const [baseSalary, setBaseSalary] = useState(''); // New State for Payroll
    const [unitRate, setUnitRate] = useState(''); // New State for Designers

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [usersData, suppliersData] = await Promise.all([
                db.getUsers(),
                db.getSuppliers()
            ]);
            setUsers(usersData);
            setSuppliers(suppliersData);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenModal = (user?: User) => {
        if (user) {
            setEditingUser(user);
            setName(user.name);
            setEmail(user.email || '');
            setUsername(user.username);
            setPassword(''); // Don't show password when editing
            setRole(user.role);
            setEntityId(user.entityId || '');
            setBaseSalary(user.baseSalary?.toString() || '');
            setUnitRate(user.unitRate?.toString() || '');
        } else {
            setEditingUser(null);
            setName('');
            setEmail('');
            setUsername('');
            setPassword('');
            setRole('lab');
            setEntityId('');
            setBaseSalary('');
            setUnitRate('');
        }
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Validation
            if (!editingUser && (!password || password.length < 8)) {
                alert('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
                return;
            }

            const userData: User & { password?: string } = {
                id: editingUser ? editingUser.id : crypto.randomUUID(),
                name,
                email,
                username,
                ...(editingUser ? {} : { password }), // Only include password for new users
                role,
                entityId: role === 'lab' ? entityId : undefined,
                baseSalary: role === 'representative' ? parseFloat(baseSalary) || 0 : undefined,
                unitRate: role === 'designer' ? parseFloat(unitRate) || 0 : undefined,
                auth_id: editingUser?.auth_id
            };

            if (editingUser) {
                await db.updateUser(userData);
            } else {
                await db.addUser(userData);
            }
            setShowModal(false);
            await loadData();
        } catch (error: any) {
            alert(ErrorHandler.getUserMessage(error));
        }
    };

    const handleDeleteClick = (user: User) => {
        setDeleteConfirm({
            isOpen: true,
            userId: user.id,
            userName: user.name
        });
    };

    const handleDeleteConfirm = async () => {
        if (!deleteConfirm.userId) return;

        try {
            await db.deleteUser(deleteConfirm.userId);
            setDeleteConfirm({ isOpen: false, userId: null, userName: '' });
            await loadData();
        } catch (error: any) {
            alert(ErrorHandler.getUserMessage(error));
        }
    };

    const handleDeleteCancel = () => {
        setDeleteConfirm({ isOpen: false, userId: null, userName: '' });
    };

    const getRoleBadge = (role: string) => {
        const styles: Record<string, string> = {
            admin: 'bg-red-100 text-red-700',
            lab: 'bg-blue-100 text-blue-700',
            representative: 'bg-green-100 text-green-700',
            accountant: 'bg-purple-100 text-purple-700',
            designer: 'bg-amber-100 text-amber-700'
        };
        const labels: Record<string, string> = {
            admin: 'مدير نظام (Admin)',
            lab: 'معمل خارجي (Lab)',
            representative: 'مندوب (Rep)',
            accountant: 'محاسب (Accountant)',
            designer: 'مصمم (Designer)'
        };
        return <span className={`px-2 py-1 rounded text-xs font-bold ${styles[role] || 'bg-gray-100'}`}>{labels[role] || role}</span>;
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">إدارة المستخدمين والصلاحيات</h1>
                    {isLoading && <span className="text-sm text-blue-600 animate-pulse">جاري التحميل...</span>}
                </div>
                {isSuperAdmin && (
                    <button
                        onClick={() => handleOpenModal()}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition"
                    >
                        <Plus size={20} />
                        <span>مستخدم جديد</span>
                    </button>
                )}
            </div>

            {/* Users List */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-right">
                    <thead className="bg-gray-50 text-gray-500 text-sm">
                        <tr>
                            <th className="p-4">الاسم</th>
                            <th className="p-4">اسم المستخدم</th>
                            <th className="p-4">الدور (Role)</th>
                            <th className="p-4">مرتبط بـ / الراتب</th>
                            <th className="p-4">إجراءات</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {users.map(user => (
                            <tr key={user.id} className="hover:bg-gray-50">
                                <td className="p-4 font-bold text-gray-800 flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                                        <UserIcon size={16} />
                                    </div>
                                    {user.name}
                                </td>
                                <td className="p-4 font-mono text-gray-600">{user.username}</td>
                                <td className="p-4">{getRoleBadge(user.role)}</td>
                                <td className="p-4 text-sm text-gray-500">
                                    {user.role === 'lab' && user.entityId ? (
                                        <span className="flex items-center gap-1 text-blue-600">
                                            <Shield size={14} />
                                            {suppliers.find(s => s.id === user.entityId)?.name || 'غير معروف'}
                                        </span>
                                    ) : user.role === 'representative' ? (
                                        <span className="text-green-600 font-bold">{user.baseSalary?.toLocaleString()} ج.م</span>
                                    ) : user.role === 'designer' ? (
                                        <span className="text-amber-600 font-bold">{user.unitRate?.toLocaleString()} ج.م / Unit</span>
                                    ) : '---'}
                                </td>
                                <td className="p-4 flex gap-2">
                                    {user.username !== 'admin' && (
                                        <>
                                            <button onClick={() => handleOpenModal(user)} className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg"><Edit2 size={18} /></button>
                                            {isSuperAdmin && (
                                                <button onClick={() => handleDeleteClick(user)} className="text-red-500 hover:bg-red-50 p-2 rounded-lg"><Trash2 size={18} /></button>
                                            )}
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="text-lg font-bold text-gray-800">{editingUser ? 'تعديل مستخدم' : 'مستخدم جديد'}</h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">الاسم بالكامل</label>
                                <input required type="text" className="w-full p-2 border rounded-lg" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">البريد الإلكتروني (Login Email)</label>
                                <input required type="email" className="w-full p-2 border rounded-lg" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@lab.com" />
                                <p className="text-xs text-gray-400 mt-1">يجب أن يطابق الإيميل المسجل في جزء Authentication.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">اسم المستخدم (للدخول)</label>
                                <input required type="text" className="w-full p-2 border rounded-lg" value={username} onChange={e => setUsername(e.target.value)} />
                            </div>
                            {!editingUser && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور</label>
                                    <input
                                        required={!editingUser}
                                        type="password"
                                        className="w-full p-2 border rounded-lg"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="8 أحرف على الأقل"
                                        minLength={8}
                                    />
                                    <p className="text-xs text-gray-400 mt-1">يتم إنشاء حساب المستخدم تلقائياً في Supabase Auth</p>
                                </div>
                            )}
                            {editingUser && (
                                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                                    <p className="text-xs text-yellow-800">لا يمكن تغيير كلمة المرور من هنا. يجب تغييرها عبر Supabase Auth مباشرة.</p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">الدور (Role)</label>
                                <select className="w-full p-2 border rounded-lg" value={role} onChange={e => setRole(e.target.value as any)}>
                                    <option value="admin">مدير نظام (Admin)</option>
                                    <option value="lab">معمل خارجي (Lab)</option>
                                    <option value="representative">مندوب (Representative)</option>
                                    <option value="accountant">محاسب (Accountant)</option>
                                    <option value="designer">مصمم (Designer)</option>
                                </select>
                            </div>

                            {/* Conditional Fields */}
                            {role === 'lab' && (
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                    <label className="block text-sm font-bold text-blue-800 mb-1">ربط بمعمل خارجي</label>
                                    <select
                                        required
                                        className="w-full p-2 border rounded-lg"
                                        value={entityId}
                                        onChange={e => setEntityId(e.target.value)}
                                    >
                                        <option value="">-- اختر المعمل --</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-blue-600 mt-1">هذا المستخدم سيشاهد فقط الحالات الخاصة بهذا المعمل.</p>
                                </div>
                            )}

                            {role === 'representative' && (
                                <div className="bg-green-50 p-3 rounded-lg border border-green-100 space-y-2">
                                    <p className="text-xs text-green-700">هذا المستخدم سيتمكن من إضافة حالات، وسيرى فقط الحالات التي أضافها أو التي تم تعيينه لها كمندوب.</p>
                                    <div>
                                        <label className="block text-sm font-bold text-green-800 mb-1">الراتب الأساسي (Base Salary)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full p-2 border rounded-lg border-green-200"
                                            value={baseSalary}
                                            onChange={e => setBaseSalary(e.target.value)}
                                            placeholder="0.00"
                                        />
                                        <p className="text-xs text-green-600 mt-1">يُستخدم لحساب الرواتب والعمولات في صفحة شؤون الموظفين.</p>
                                    </div>
                                </div>
                            )}

                            {role === 'designer' && (
                                <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 space-y-2">
                                    <p className="text-xs text-amber-700">سيتمكن هذا المستخدم من رؤية الحالات الموكلة إليه للتصميم فقط.</p>
                                    <div>
                                        <label className="block text-sm font-bold text-amber-800 mb-1">سعر القطعة (Unit Rate)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            className="w-full p-2 border rounded-lg border-amber-200"
                                            value={unitRate}
                                            onChange={e => setUnitRate(e.target.value)}
                                            placeholder="مثلاً: 50"
                                        />
                                        <p className="text-xs text-amber-600 mt-1">المبلغ الذي يتقاضاه المصمم عن كل قطعة (Unit) يقوم بتصميمها.</p>
                                    </div>
                                </div>
                            )}

                            <div className="pt-4 flex gap-3">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">إلغاء</button>
                                <button type="submit" className="flex-1 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700">حفظ</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                isOpen={deleteConfirm.isOpen}
                title="تأكيد الحذف"
                message={`هل أنت متأكد من حذف المستخدم "${deleteConfirm.userName}"؟ سيتم حذف جميع بياناته ولا يمكن التراجع عن هذه العملية.`}
                confirmText="حذف"
                cancelText="إلغاء"
                onConfirm={handleDeleteConfirm}
                onCancel={handleDeleteCancel}
                variant="danger"
            />
        </div>
    );
}
