import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package,
  Truck,
  CheckCircle2,
  Search,
  Camera,
  ExternalLink,
  X,
  User,
  Phone,
  MapPin,
  RefreshCw,
  Send
} from 'lucide-react';
import {
  shippingService,
  type Shipment,
  type ReadyToPackOrder
} from '../../services/supabase/shippingService';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

export const Shipments: React.FC = () => {
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  const { user } = useAuth();
  const role = user?.role;
  const isAuthorized = ['admin', 'lab', 'accountant'].includes(role || '');

  // State
  const [activeTab, setActiveTab] = useState<'ready' | 'active' | 'delivered'>('ready');
  const [loading, setLoading] = useState(true);
  const [readyOrders, setReadyOrders] = useState<ReadyToPackOrder[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [couriers, setCouriers] = useState<Array<{ id: string; name: string; phone?: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Multi-selection for packing
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [selectedShipmentForDelivery, setSelectedShipmentForDelivery] = useState<Shipment | null>(null);
  const [selectedShipmentDetails, setSelectedShipmentDetails] = useState<Shipment | null>(null);

  // Form State: Create Shipment
  const [formCourierId, setFormCourierId] = useState('');
  const [formTrackingRef, setFormTrackingRef] = useState('');
  const [formRecipientName, setFormRecipientName] = useState('');
  const [formRecipientPhone, setFormRecipientPhone] = useState('');
  const [formDeliveryAddress, setFormDeliveryAddress] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formProofFiles, setFormProofFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State: Confirm Delivery
  const [deliveryProofFile, setDeliveryProofFile] = useState<File | null>(null);
  const [deliveryNotes, setDeliveryNotes] = useState('');

  // Load Data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [readyRes, shipRes, courierRes] = await Promise.all([
        shippingService.getReadyToPackOrders(),
        shippingService.getShipments(),
        shippingService.getCouriers()
      ]);
      setReadyOrders(readyRes);
      setShipments(shipRes);
      setCouriers(courierRes);
    } catch (err: unknown) {
      console.error('Failed to load shipping data:', err);
      toastError('فشل تحميل بيانات الشحن');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filtered Ready Orders
  const filteredReadyOrders = useMemo(() => {
    return readyOrders.filter(ord => {
      const matchSearch =
        !searchQuery ||
        ord.case_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ord.patient_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ord.doctor?.name && ord.doctor.name.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchSearch;
    });
  }, [readyOrders, searchQuery]);

  // Group ready orders by doctor
  const readyOrdersByDoctor = useMemo(() => {
    const map = new Map<string, { doctorName: string; doctorId: string; address?: string; phone?: string; orders: ReadyToPackOrder[] }>();
    filteredReadyOrders.forEach(ord => {
      const docId = ord.doctor_id || 'unassigned';
      const docName = ord.doctor?.name || 'طبيب غير محدد';
      if (!map.has(docId)) {
        map.set(docId, {
          doctorId: docId,
          doctorName: docName,
          address: ord.doctor?.address || '',
          phone: ord.doctor?.phone || '',
          orders: []
        });
      }
      map.get(docId)?.orders.push(ord);
    });
    return Array.from(map.values());
  }, [filteredReadyOrders]);

  // Filtered Active Shipments
  const activeShipments = useMemo(() => {
    return shipments.filter(s => ['packing', 'ready_for_pickup', 'dispatched'].includes(s.status));
  }, [shipments]);

  // Filtered Delivered Shipments
  const deliveredShipments = useMemo(() => {
    return shipments.filter(s => s.status === 'delivered');
  }, [shipments]);

  // Handle open create modal from selected orders
  const handleOpenPackSelected = (orderIdsToPack: string[], docInfo?: { name: string; phone?: string; address?: string }) => {
    setSelectedOrderIds(orderIdsToPack);
    if (docInfo) {
      setFormRecipientName(docInfo.name);
      setFormRecipientPhone(docInfo.phone || '');
      setFormDeliveryAddress(docInfo.address || '');
    } else {
      setFormRecipientName('');
      setFormRecipientPhone('');
      setFormDeliveryAddress('');
    }
    setFormCourierId(couriers[0]?.id || '');
    setFormTrackingRef('');
    setFormNotes('');
    setFormProofFiles([]);
    setIsCreateModalOpen(true);
  };

  // Submit Create Shipment
  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedOrderIds.length === 0) {
      toastError('يجب تحديد أوردر واحد على الأقل');
      return;
    }

    try {
      setIsSubmitting(true);

      // Upload proof photos if any
      const proofUrls: string[] = [];
      const tempCode = `TEMP-${Date.now()}`;
      for (const file of formProofFiles) {
        const url = await shippingService.uploadProofImage(file, tempCode, 'packing');
        proofUrls.push(url);
      }

      // Determine doctorId from first order if all share same doctor
      const firstOrder = readyOrders.find(o => o.id === selectedOrderIds[0]);
      const commonDoctorId = firstOrder?.doctor_id || null;

      await shippingService.createShipment({
        courierId: formCourierId || null,
        doctorId: commonDoctorId,
        trackingRef: formTrackingRef,
        orderIds: selectedOrderIds,
        packingProofUrls: proofUrls,
        recipientName: formRecipientName,
        recipientPhone: formRecipientPhone,
        deliveryAddress: formDeliveryAddress,
        notes: formNotes
      });

      toastSuccess('تم تجهيز الشحنة وإضافتها لطابور الاستلام بنجاح');
      setIsCreateModalOpen(false);
      setSelectedOrderIds([]);
      setActiveTab('active');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to create shipment:', err);
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء إنشاء الشحنة';
      toastError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dispatch Shipment
  const handleDispatch = async (shipment: Shipment) => {
    const tracking = window.prompt('أدخل رقم البوليصة / التتبع (اختياري):', shipment.tracking_ref || '');
    if (tracking === null) return;

    try {
      await shippingService.dispatchShipment(shipment.id, tracking);
      toastSuccess(`تم تسليم الشحنة ${shipment.shipment_code} للمندوب/شركة الشحن`);
      loadData();
    } catch (err: unknown) {
      console.error('Failed to dispatch:', err);
      const msg = err instanceof Error ? err.message : 'فشل تسليم الشحنة';
      toastError(msg);
    }
  };

  // Submit Confirm Delivery
  const handleConfirmDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipmentForDelivery) return;

    try {
      setIsSubmitting(true);
      let proofUrl: string | undefined = undefined;
      if (deliveryProofFile) {
        proofUrl = await shippingService.uploadProofImage(
          deliveryProofFile,
          selectedShipmentForDelivery.shipment_code,
          'delivery'
        );
      }

      const result = await shippingService.confirmDelivery(
        selectedShipmentForDelivery.id,
        proofUrl,
        new Date().toISOString(),
        deliveryNotes
      );

      // Confirming delivery is what bills the doctor. Any case the delivery RPC
      // refused (open issue, already delivered) was NOT billed, so a flat
      // "تم بنجاح" would hide a case nobody charged for.
      if (result.orders_skipped.length > 0) {
        const cases = result.orders_skipped
          .map(o => `${o.case_id} (${o.reason === 'open_issue' ? 'عليها مشكلة مفتوحة' : 'مسلّمة قبل كده'})`)
          .join('، ');
        toastWarning(
          `الشحنة ${selectedShipmentForDelivery.shipment_code}: اتسجّل تسليم ${result.orders_delivered} من ${result.orders_in_shipment}. ` +
          `الحالات دي متحسبتش على حساب الطبيب: ${cases}`
        );
      } else {
        toastSuccess(
          `تم تأكيد تسليم الشحنة ${selectedShipmentForDelivery.shipment_code} — ${result.orders_delivered} حالة اتسجّلت على حساب الطبيب`
        );
      }
      setIsDeliveryModalOpen(false);
      setSelectedShipmentForDelivery(null);
      setDeliveryProofFile(null);
      setDeliveryNotes('');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to confirm delivery:', err);
      const msg = err instanceof Error ? err.message : 'فشل تأكيد التسليم';
      toastError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Cancel Shipment
  const handleCancelShipment = async (shipment: Shipment) => {
    if (!window.confirm(`هل أنت متأكد من إلغاء الشحنة ${shipment.shipment_code} وإعادة الأوردرات لطابور التغليف؟`)) {
      return;
    }

    try {
      await shippingService.cancelShipment(shipment.id, 'تم الإلغاء من قبل المستخدم');
      toastSuccess('تم إلغاء الشحنة وإعادة الأوردرات');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to cancel shipment:', err);
      const msg = err instanceof Error ? err.message : 'فشل إلغاء الشحنة';
      toastError(msg);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">إدارة التغليف والشحن والتسليم</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                تجميع الطرود، إثبات جودة التغليف بالصور، تتبع شركات الشحن، وتأكيد التسليم للطبيب
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isAuthorized && (
            <button
              onClick={() => handleOpenPackSelected(selectedOrderIds)}
              disabled={selectedOrderIds.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium transition shadow-sm"
            >
              <Package className="w-5 h-5" />
              <span>تجهيز طرد ({selectedOrderIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-xl">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{readyOrders.length}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">حالات جاهزة للتغليف والشحن</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl">
            <Truck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{activeShipments.length}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">شحنات جارية مع المناديب</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{deliveredShipments.length}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">شحنات تم تسليمها بنجاح</div>
          </div>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('ready')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'ready'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            جاهز للتغليف ({readyOrders.length})
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'active'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            الشحنات النشطة ({activeShipments.length})
          </button>
          <button
            onClick={() => setActiveTab('delivered')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'delivered'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            سجل التسليمات ({deliveredShipments.length})
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="بحث برقم الحالة / الطبيب..."
              className="w-full pl-3 pr-9 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Tab Content 1: Ready to Pack */}
      {activeTab === 'ready' && (
        <div className="space-y-6">
          {readyOrdersByDoctor.length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Package className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400">لا توجد حالات جاهزة للتغليف حالياً</p>
            </div>
          ) : (
            readyOrdersByDoctor.map(group => {
              const allGroupIds = group.orders.map(o => o.id);
              const isAllSelected = allGroupIds.every(id => selectedOrderIds.includes(id));

              const toggleGroup = () => {
                if (isAllSelected) {
                  setSelectedOrderIds(prev => prev.filter(id => !allGroupIds.includes(id)));
                } else {
                  setSelectedOrderIds(prev => Array.from(new Set([...prev, ...allGroupIds])));
                }
              };

              return (
                <div
                  key={group.doctorId}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
                >
                  {/* Doctor Group Header */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleGroup}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                      />
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          <User className="w-4 h-4 text-blue-500" />
                          <span>{group.doctorName}</span>
                          <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">
                            {group.orders.length} حالات جاهزة
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-4 mt-0.5">
                          {group.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {group.phone}
                            </span>
                          )}
                          {group.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {group.address}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {isAuthorized && (
                      <button
                        onClick={() =>
                          handleOpenPackSelected(allGroupIds, {
                            name: group.doctorName,
                            phone: group.phone,
                            address: group.address
                          })
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition"
                      >
                        <Package className="w-3.5 h-3.5" />
                        <span>تغليف الكل في طرد واحد ({group.orders.length})</span>
                      </button>
                    )}
                  </div>

                  {/* Orders Table */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {group.orders.map(order => {
                      const isSelected = selectedOrderIds.includes(order.id);
                      return (
                        <div
                          key={order.id}
                          className={`p-4 flex items-center justify-between gap-4 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                            isSelected ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedOrderIds(prev =>
                                  isSelected ? prev.filter(id => id !== order.id) : [...prev, order.id]
                                );
                              }}
                              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                            />
                            <div>
                              <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                                <span>{order.case_id}</span>
                                {order.shade && (
                                  <span className="text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                                    {order.shade}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                المريض: <span className="font-medium text-slate-700 dark:text-slate-300">{order.patient_name}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-left">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                                {order.total_price.toLocaleString()} ج.م
                              </div>
                              <div className="text-xs text-slate-400">
                                موعد التسليم: {order.delivery_date ? new Date(order.delivery_date).toLocaleDateString('ar-EG') : '—'}
                              </div>
                            </div>

                            {isAuthorized && (
                              <button
                                onClick={() =>
                                  handleOpenPackSelected([order.id], {
                                    name: group.doctorName,
                                    phone: group.phone,
                                    address: group.address
                                  })
                                }
                                className="px-3 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 rounded-lg font-medium transition"
                              >
                                تغليف منفرد
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab Content 2 & 3: Active & Delivered Shipments */}
      {(activeTab === 'active' || activeTab === 'delivered') && (
        <div className="space-y-4">
          {(activeTab === 'active' ? activeShipments : deliveredShipments).length === 0 ? (
            <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Truck className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 dark:text-slate-400">
                {activeTab === 'active' ? 'لا توجد شحنات نشطة حالياً' : 'لا يوجد سجل تسليمات حتى الآن'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(activeTab === 'active' ? activeShipments : deliveredShipments).map(shipment => {
                const isDelivered = shipment.status === 'delivered';
                const isDispatched = shipment.status === 'dispatched';

                return (
                  <div
                    key={shipment.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4 hover:border-slate-300 dark:hover:border-slate-700 transition"
                  >
                    {/* Shipment Top Bar */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 dark:text-white">{shipment.shipment_code}</span>
                          <span
                            className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                              isDelivered
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : isDispatched
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            }`}
                          >
                            {isDelivered
                              ? 'تم التسليم'
                              : isDispatched
                              ? 'مع شركة الشحن'
                              : 'جاهز للاستلام'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          تاريخ التجهيز: {new Date(shipment.created_at).toLocaleDateString('ar-EG')}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {shipment.packing_proof_urls.length > 0 && (
                          <button
                            onClick={() => setSelectedShipmentDetails(shipment)}
                            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg text-xs flex items-center gap-1"
                            title="صور التغليف"
                          >
                            <Camera className="w-4 h-4" />
                            <span>{shipment.packing_proof_urls.length} صور</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Recipient & Courier Info */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-xl text-xs space-y-1.5">
                      <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-medium">
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {shipment.recipient_name || shipment.doctor?.name || 'غير محدد'}
                        </span>
                        {shipment.courier && (
                          <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                            <Truck className="w-3.5 h-3.5" />
                            {shipment.courier.name}
                          </span>
                        )}
                      </div>

                      {shipment.recipient_phone && (
                        <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {shipment.recipient_phone}
                        </div>
                      )}

                      {shipment.delivery_address && (
                        <div className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <MapPin className="w-3 h-3" /> {shipment.delivery_address}
                        </div>
                      )}

                      {shipment.tracking_ref && (
                        <div className="text-slate-700 dark:text-slate-300 font-mono text-[11px] bg-white dark:bg-slate-900 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 inline-block mt-1">
                          بوليصة الشحن: {shipment.tracking_ref}
                        </div>
                      )}
                    </div>

                    {/* Contained Orders */}
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 flex items-center justify-between">
                        <span>محتويات الطرد ({shipment.orders?.length || 0} حالات):</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {shipment.orders?.map(so => (
                          <span
                            key={so.id}
                            className="px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-md font-mono"
                          >
                            {so.order?.case_id || 'أوردر'} - {so.order?.patient_name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Delivery Proof (if delivered) */}
                    {isDelivered && shipment.delivery_proof_url && (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" /> تم التسليم{' '}
                          {shipment.delivered_at ? new Date(shipment.delivered_at).toLocaleDateString('ar-EG') : ''}
                        </span>
                        <a
                          href={shipment.delivery_proof_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1"
                        >
                          إثبات التسليم <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {/* Actions for Active Shipments */}
                    {!isDelivered && isAuthorized && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleCancelShipment(shipment)}
                          className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition font-medium"
                        >
                          إلغاء
                        </button>
                        {!isDispatched && (
                          <button
                            onClick={() => handleDispatch(shipment)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium shadow-sm"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>تسليم للمندوب</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedShipmentForDelivery(shipment);
                            setIsDeliveryModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-medium shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>تأكيد التسليم</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Create & Pack Shipment */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-lg">
                <Package className="w-5 h-5 text-blue-600" />
                <span>تجهيز وإغلاق طرد شحن</span>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShipment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  الأوردرات المختارة ({selectedOrderIds.length})
                </label>
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-400 max-h-24 overflow-y-auto">
                  {selectedOrderIds.map(id => {
                    const ord = readyOrders.find(o => o.id === id);
                    return ord ? (
                      <div key={id} className="py-0.5 flex items-center justify-between">
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200">{ord.case_id}</span>
                        <span>{ord.patient_name}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    شركة الشحن / المندوب
                  </label>
                  <select
                    value={formCourierId}
                    onChange={e => setFormCourierId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-- اختر شركة الشحن --</option>
                    {couriers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم بوليصة الشحن (اختياري)
                  </label>
                  <input
                    type="text"
                    value={formTrackingRef}
                    onChange={e => setFormTrackingRef(e.target.value)}
                    placeholder="TRK-XXXXX"
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    اسم المستلم (الطبيب/العيادة)
                  </label>
                  <input
                    type="text"
                    value={formRecipientName}
                    onChange={e => setFormRecipientName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={formRecipientPhone}
                    onChange={e => setFormRecipientPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  عنوان التسليم
                </label>
                <input
                  type="text"
                  value={formDeliveryAddress}
                  onChange={e => setFormDeliveryAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Proof Photos Upload */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center justify-between">
                  <span>صور إثبات التغليف قبل الغلق (اختياري)</span>
                  <span className="text-slate-400 font-normal">{formProofFiles.length} ملفات مختارة</span>
                </label>
                <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 p-4 rounded-xl text-center hover:border-blue-500 cursor-pointer relative bg-slate-50 dark:bg-slate-800/40">
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={e => {
                      if (e.target.files) {
                        setFormProofFiles(Array.from(e.target.files));
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <Camera className="w-6 h-6 text-slate-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-500">اضغط أو اسحب صور الطرد من الداخل لحماية المعمل</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ملاحظات
                </label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  rows={2}
                  placeholder="أي تعليمات للمندوب أو شركة الشحن..."
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium transition shadow-sm flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>جاري الحفظ والرفع...</span>
                    </>
                  ) : (
                    <span>تأكيد التغليف</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delivery */}
      {isDeliveryModalOpen && selectedShipmentForDelivery && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>تأكيد تسليم الشحنة</span>
              </div>
              <button
                onClick={() => setIsDeliveryModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmDelivery} className="space-y-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                <div className="font-semibold">الشحنة: {selectedShipmentForDelivery.shipment_code}</div>
                <div>المستلم: {selectedShipmentForDelivery.recipient_name || selectedShipmentForDelivery.doctor?.name}</div>
                <div>عدد الحالات المشمولة: {selectedShipmentForDelivery.orders?.length || 0}</div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  صورة إثبات التسليم / التوقيع (اختياري)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setDeliveryProofFile(e.target.files[0]);
                    }
                  }}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ملاحظات التسليم
                </label>
                <textarea
                  value={deliveryNotes}
                  onChange={e => setDeliveryNotes(e.target.value)}
                  rows={2}
                  placeholder="تم الاستلام باليد / تسليم العيادة..."
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsDeliveryModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl font-medium transition shadow-sm flex items-center gap-2"
                >
                  {isSubmitting ? 'جاري التأكيد...' : 'تأكيد التسليم النهائي'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: View Packing Proof Photos */}
      {selectedShipmentDetails && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="font-bold text-slate-900 dark:text-white">
                صور إثبات التغليف — {selectedShipmentDetails.shipment_code}
              </div>
              <button
                onClick={() => setSelectedShipmentDetails(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-96 overflow-y-auto p-2">
              {selectedShipmentDetails.packing_proof_urls.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group relative aspect-square bg-slate-100 dark:bg-slate-800"
                >
                  <img
                    src={url}
                    alt={`إثبات ${i + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition"
                  />
                  <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs gap-1">
                    <ExternalLink className="w-4 h-4" /> تكبير
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Shipments;
