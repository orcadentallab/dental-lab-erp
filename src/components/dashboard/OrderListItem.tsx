import { useNavigate } from 'react-router-dom';
import type { Order } from '../../services/db';

interface OrderListItemProps {
    order: Order;
    labName?: string;
    designerName?: string;
    onRegister?: (orderId: string) => void;
    showRegister?: boolean;
}

export default function OrderListItem({
    order,
    labName,
    designerName,
    onRegister,
    showRegister = false
}: OrderListItemProps) {
    const navigate = useNavigate();

    const handleNavigate = () => {
        navigate(`/orders?highlight=${order.id}`);
    };

    return (
        <div className="flex items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors border-b border-gray-200 dark:border-gray-600 last:border-0">
            <div className="flex-1 grid grid-cols-5 gap-4 items-center">
                {/* Case ID */}
                <div>
                    <span className="font-mono text-sm font-bold text-blue-600 dark:text-blue-400">
                        #{order.caseId}
                    </span>
                </div>

                {/* Patient Name */}
                <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {order.patientName}
                    </span>
                </div>

                {/* Services */}
                <div>
                    <div className="flex flex-wrap gap-1">
                        {order.items?.slice(0, 2).map((item, idx) => (
                            <span key={idx} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                {item.serviceType}
                            </span>
                        ))}
                        {order.items && order.items.length > 2 && (
                            <span className="text-xs text-gray-500">+{order.items.length - 2}</span>
                        )}
                    </div>
                </div>

                {/* Lab/Designer Name */}
                <div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        {designerName || labName || '-'}
                    </span>
                </div>

                {/* Status */}
                <div>
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                        {order.status}
                    </span>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 mr-4">
                <button
                    onClick={handleNavigate}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition-colors"
                >
                    عرض
                </button>
                {showRegister && !order.isRegistered && order.status === 'Delivered' && onRegister && (
                    <button
                        onClick={() => onRegister(order.id)}
                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded transition-colors"
                    >
                        تسجيل
                    </button>
                )}
            </div>
        </div>
    );
}
