import ShippingAreaSelect from '../../components/finance/ShippingAreaSelect';
import { financeService } from '../../services/financeService';
import { db, type Doctor, type Order } from '../../services/db';
import { supabase } from '../../lib/supabase';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  ACTIVE_SHIPMENT_STATUSES,
  type Shipment,
  type ReadyToPackOrder
} from '../../services/supabase/shippingService';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { refreshNavBadges } from '../../hooks/useNavBadges';
import { MIXED_TRY_IN_ROUTE_ID } from '../../services/supabase/production';

function clinicRecipient(order: ReadyToPackOrder) {
  const doctor = order.doctor;
  const parent = doctor?.parent;
  const childBranch = doctor?.branches?.find(branch => branch.name === order.branch_name);
  const parentBranch = parent?.branches?.find(branch => branch.name === order.branch_name);
  const branch = childBranch ?? parentBranch;
  const clinic = !childBranch && parentBranch ? parent : doctor;
  return {
    name: [clinic?.name, order.branch_name].filter(Boolean).join(' · '),
    phone: branch?.phone || clinic?.phone || parent?.phone || '',
    area: branch?.shippingArea || clinic?.shipping_area || parent?.shipping_area || '',
    address: branch?.address || clinic?.address || parent?.address || '',
  };
}

function shipmentCaseCount(shipments: Shipment[]) {
  return new Set(shipments.flatMap(shipment =>
    shipment.orders?.length ? shipment.orders.map(order => order.order_id) : shipment.intake_patient_name ? [shipment.id] : []
  )).size;
}

export const Shipments: React.FC = () => {
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  const { user } = useAuth();
  const role = user?.role;
  // Decision 4: shipping is shared, so a courier hand-off never waits on one
  // person being at their desk. 'lab' drops off -- it was the production
  // manager under the wrong name, and an external supplier never dispatched
  // our shipments.
  const isAuthorized = ['admin', 'production_manager', 'coordinator', 'accountant'].includes(role || '');
  const canUseCashDelivery = ['admin', 'accountant', 'coordinator'].includes(role ?? '');
  const [params, setParams] = useSearchParams();
  const focusedOrderId = params.get('order');
  const focusedAttemptId = params.get('attempt');

  // State
  const [activeTab, setActiveTab] = useState<'ready' | 'active' | 'delivered' | 'attempts'>(() => focusedAttemptId ? 'attempts' : 'ready');
  useEffect(() => {
    if (focusedAttemptId || focusedOrderId) setActiveTab(focusedAttemptId ? 'attempts' : 'ready');
  }, [focusedAttemptId, focusedOrderId]);
  const [loading, setLoading] = useState(true);
  const [readyOrders, setReadyOrders] = useState<ReadyToPackOrder[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [couriers, setCouriers] = useState<Array<{ id: string; name: string; phone?: string }>>([]);
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(window.location.search).get('case') ?? '');

  // Multi-selection for packing
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [selectedShipmentForDelivery, setSelectedShipmentForDelivery] = useState<Shipment | null>(null);
  const [selectedShipmentDetails, setSelectedShipmentDetails] = useState<Shipment | null>(null);
  const isTrialOnlyShipment = !!selectedShipmentForDelivery?.orders?.length &&
    selectedShipmentForDelivery.orders.every(({ order }) =>
      order?.route_override_id === MIXED_TRY_IN_ROUTE_ID && order.production_status === 'try_in_ready'
    );

  // Form State: Create Shipment
  const [formCourierId, setFormCourierId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [direction, setDirection] = useState<'to_doctor' | 'to_lab'>('to_doctor');
  const [formArea, setFormArea] = useState('');
  const [scooter, setScooter] = useState(false);
  const [cashCarrier, setCashCarrier] = useState<'scooter' | 'middle_east'>('scooter');
  const [hubLeg, setHubLeg] = useState(false);
  const [lastMile, setLastMile] = useState(false);
  const [createExpense, setCreateExpense] = useState(true);
  const [newPatient, setNewPatient] = useState('');
  const [newCase, setNewCase] = useState(false);
  const [scooterAmount, setScooterAmount] = useState('');
  const [cashbox, setCashbox] = useState('');
  const [cashboxes, setCashboxes] = useState<{ id: string; name: string }[]>([]);

  const [expenseId, setExpenseId] = useState('');
  const [expenses, setExpenses] = useState<{ id: string; amount: number; description: string }[]>([]);
  const [clinics, setClinics] = useState<Doctor[]>([]);
  const [pickupDoctor, setPickupDoctor] = useState('');
  const [pickupOrders, setPickupOrders] = useState<Order[]>([]);
  const [pickupBranch, setPickupBranch] = useState('');

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
  const [closingAttempt, setClosingAttempt] = useState<Shipment | null>(null);
  const [attemptOutcome, setAttemptOutcome] = useState<'failed' | 'returned' | 'cancelled'>('failed');
  const [attemptReason, setAttemptReason] = useState('');
  const [recordAttemptExpense, setRecordAttemptExpense] = useState(false);


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

  const completedHubIds = useMemo(() => {
    const deliveredOrdersByHub = new Map<string, Set<string>>();
    for (const shipment of shipments) {
      if (!shipment.previous_shipping_leg || shipment.status !== 'delivered') continue;
      const deliveredOrders = deliveredOrdersByHub.get(shipment.previous_shipping_leg) ?? new Set<string>();
      for (const order of shipment.orders ?? []) deliveredOrders.add(order.order_id);
      deliveredOrdersByHub.set(shipment.previous_shipping_leg, deliveredOrders);
    }
    return new Set(shipments.filter(shipment => {
      const deliveredOrders = deliveredOrdersByHub.get(shipment.id);
      return shipment.hub_leg && shipment.status === 'delivered' && !!shipment.orders?.length
        && shipment.orders.every(order => deliveredOrders?.has(order.order_id));
    }).map(shipment => shipment.id));
  }, [shipments]);

  const activeShipments = useMemo(() => shipments.filter(shipment =>
    ACTIVE_SHIPMENT_STATUSES.includes(shipment.status) ||
    (shipment.hub_leg && shipment.status === 'delivered' && !completedHubIds.has(shipment.id))
  ), [shipments, completedHubIds]);

  const deliveredShipments = useMemo(() => shipments.filter(shipment =>
    shipment.status === 'delivered' && (!shipment.hub_leg || completedHubIds.has(shipment.id))
  ), [shipments, completedHubIds]);

  const closedAttempts = shipments.filter(item => ['failed','returned','cancelled'].includes(item.status));
  const visibleAttempts = focusedAttemptId ? closedAttempts.filter(item => item.id === focusedAttemptId) : closedAttempts;

  const readyForPacking = useMemo(() => {
    const hubOrderIds = new Set(activeShipments.filter(shipment => shipment.hub_leg && shipment.status === 'delivered')
      .flatMap(shipment => shipment.orders?.map(order => order.order_id) ?? []));
    return readyOrders.filter(order => !hubOrderIds.has(order.id));
  }, [readyOrders, activeShipments]);

  const visibleReadyOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return readyForPacking.filter(order =>
      focusedOrderId ? order.id === focusedOrderId : !query || [order.case_id, order.patient_name, order.doctor?.name].some(value => value?.toLowerCase().includes(query))
    );
  }, [readyForPacking, searchQuery, focusedOrderId]);

  // Group ready orders by doctor
  const readyOrdersByDoctor = useMemo(() => {
    const map = new Map<string, { doctorName: string; doctorId: string; address?: string; phone?: string; orders: ReadyToPackOrder[] }>();
    visibleReadyOrders.forEach(ord => {
      const docId = ord.doctor_id || 'unassigned';
      const groupKey = JSON.stringify([docId, ord.branch_name]);
      const clinic = clinicRecipient(ord);
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          doctorId: groupKey,
          doctorName: clinic.name || 'طبيب غير محدد',
          address: clinic.address,
          phone: clinic.phone,
          orders: []
        });
      }
      map.get(groupKey)?.orders.push(ord);
    });
    return Array.from(map.values());
  }, [visibleReadyOrders]);

  const openPickup = async () => {
    try {
      setClinics((await db.getDoctors()).filter(doctor => !doctor.mergedInto));
      setDirection('to_lab');
      setRequestId(crypto.randomUUID());
      setNewCase(false);
      setNewPatient('');
      setCreateExpense(true);
      setPickupDoctor('');
      setPickupBranch('');
      setPickupOrders([]);
      setSelectedOrderIds([]);
      setFormArea('');
      setFormRecipientName('');
      setFormRecipientPhone('');
      setFormDeliveryAddress('');
      setFormTrackingRef('');
      setFormNotes('');
      setFormProofFiles([]);
      setScooter(false);
    setHubLeg(false);
    setLastMile(false);
    setCashCarrier('scooter');
      setExpenseId('');
      setFormCourierId(couriers[0]?.id || '');
      setIsCreateModalOpen(true);
    } catch { toastError('تعذر تحميل العيادات'); }
  };

  useEffect(() => {
    if (!pickupDoctor || direction !== 'to_lab') return;
    let current = true;
    db.getOrders(1, 50, { doctorId: pickupDoctor }).then(result => {
      if (current) setPickupOrders(result.data);
    }).catch(() => { if (current) toastError('تعذر تحميل أوردرات العيادة'); });
    return () => { current = false; };
  }, [pickupDoctor, direction, toastError]);

  const choosePickupClinic = (doctorId: string, branchName: string) => {
    if (doctorId !== pickupDoctor) setPickupOrders([]);
    setPickupDoctor(doctorId);
    setPickupBranch(branchName);
    setSelectedOrderIds([]);
    const doctor = clinics.find(item => item.id === doctorId);
    const branch = doctor?.branches?.find(item => item.name === branchName);
    setFormRecipientName([doctor?.name, branchName].filter(Boolean).join(' · '));
    setFormRecipientPhone(branch?.phone || doctor?.phone || '');
    setFormDeliveryAddress(branch?.address || doctor?.address || '');
    setFormArea(branch?.shippingArea || doctor?.shippingArea || '');
  };

  const selectScooter = async (enabled: boolean) => {
    setScooter(enabled);
    setExpenseId('');
    if (!enabled) return;
    const { data, error } = await supabase.from('transactions').select('id,amount,description')
      .eq('type', 'expense').in('category', ['shipping', 'شحن وتوصيل']).eq('status', 'approved')
      .or('entity_type.is.null,entity_type.eq.general').order('date', { ascending: false }).limit(100);
    if (error) toastError('تعذر تحميل مصروفات الشحن');
    else setExpenses(data ?? []);
  };

  // Handle open create modal from selected orders
  const handleOpenPackSelected = (orderIdsToPack: string[], fromHub = false) => {
    const orders = readyOrders.filter(order => orderIdsToPack.includes(order.id));
    const firstOrder = orders[0];
    if (!firstOrder) return;
    if (orders.some(order => order.doctor_id !== firstOrder.doctor_id || order.branch_name !== firstOrder.branch_name)) {
      toastError('اختار حالات لنفس العيادة والفرع لتجهيزها في طرد واحد');
      return;
    }
    const docInfo = clinicRecipient(firstOrder);
    setDirection('to_doctor');
    setRequestId(crypto.randomUUID());
    setScooter(fromHub && canUseCashDelivery);
    setLastMile(fromHub);
    setHubLeg(false);
    setCashCarrier('scooter');
    setNewCase(false);
    setCreateExpense(true);
    setExpenseId('');
    setFormArea(fromHub ? 'العاشر من رمضان' : docInfo.area);
    setSelectedOrderIds(orderIdsToPack);
    setFormRecipientName(docInfo.name);
    setFormRecipientPhone(docInfo.phone);
    setFormDeliveryAddress(docInfo.address);
    setFormCourierId(fromHub ? '' : couriers[0]?.id || '');
    setFormTrackingRef('');
    setFormNotes('');
    setFormProofFiles([]);
    setIsCreateModalOpen(true);
  };

  // Submit Create Shipment
  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((direction === 'to_lab' || scooter) && !formArea) {
      toastError('اختار منطقة الشحن من القائمة قبل الحفظ');
      return;
    }
    if (selectedOrderIds.length === 0 && !(direction === 'to_lab' && newCase && newPatient.trim())) {
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
        requestId, direction, area: formArea, carrier: scooter ? cashCarrier : undefined,
        hub: !lastMile && !scooter && direction === 'to_doctor' && formArea === 'العاشر من رمضان' && hubLeg, expenseId: scooter && !createExpense ? expenseId : undefined,
        pendingExpense: scooter && createExpense,
        patient: direction === 'to_lab' && newCase ? newPatient : undefined,
        branch: direction === 'to_lab' ? pickupBranch : undefined,
        courierId: scooter || lastMile ? null : formCourierId || null,
        doctorId: direction === 'to_lab' ? pickupDoctor : commonDoctorId,
        trackingRef: formTrackingRef,
        orderIds: selectedOrderIds,
        packingProofUrls: proofUrls,
        recipientName: formRecipientName,
        recipientPhone: formRecipientPhone,
        deliveryAddress: formDeliveryAddress,
        notes: formNotes
      });

      toastSuccess(direction === 'to_lab' ? 'تم تسجيل طلب الاستلام من العيادة' : 'تم تجهيز الشحنة وإضافتها لطابور الاستلام');
      setIsCreateModalOpen(false);
      setSelectedOrderIds([]);
      setActiveTab('active');
      refreshNavBadges();
      loadData();
    } catch (err: unknown) {
      console.error('Failed to create shipment:', err);
      const msg = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message : 'حدث خطأ أثناء إنشاء الشحنة';
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
      refreshNavBadges();
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
        deliveryNotes,
        selectedShipmentForDelivery.scooter_payment_pending ? Number(scooterAmount) : undefined,
        cashbox || undefined
      );

      // Confirming delivery is what bills the doctor. Any case the delivery RPC
      // refused (open issue, already delivered) was NOT billed, so a flat
      // "تم بنجاح" would hide a case nobody charged for.
      if (selectedShipmentForDelivery.hub_leg) {
        toastSuccess('تم تأكيد وصول الطرد للعاشر. جهّز المرحلة الأخيرة من نفس الشحنة.');
        setActiveTab('active');
      } else if (selectedShipmentForDelivery.direction === 'to_lab') {
        toastSuccess('تم تأكيد وصول الشحنة للمعمل');
      } else if ((result.orders_skipped ?? []).length > 0) {
        const cases = result.orders_skipped
          .map(o => `${o.case_id} (${o.reason === 'open_issue' ? 'عليها مشكلة مفتوحة' : 'مسلّمة قبل كده'})`)
          .join('، ');
        toastWarning(
          `الشحنة ${selectedShipmentForDelivery.shipment_code}: اتسجّل تسليم ${result.orders_delivered} من ${result.orders_in_shipment}. ` +
          `الحالات دي متحسبتش على حساب الطبيب: ${cases}`
        );
      } else if (result.orders_trial_received) {
        toastSuccess(`تم تأكيد وصول ${result.orders_trial_received} بروفة. الحالات تنتظر رد الطبيب.${result.orders_delivered ? ` وتم تأكيد الاستلام النهائي لـ${result.orders_delivered} حالة.` : ''}`);
      } else {
        toastSuccess(
          `تم تأكيد تسليم الشحنة ${selectedShipmentForDelivery.shipment_code} — ${result.orders_delivered} حالة اتسجّلت على حساب الطبيب`
        );
      }
      setIsDeliveryModalOpen(false);
      refreshNavBadges();
      setSelectedShipmentForDelivery(null);
      setDeliveryProofFile(null);
      setDeliveryNotes('');
      loadData();
    } catch (err: unknown) {
      console.error('Failed to confirm delivery:', err);
      const msg = err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message : 'فشل تأكيد التسليم';
      toastError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeAttempt = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!closingAttempt || !attemptReason.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await shippingService.closeAttempt(closingAttempt.id, attemptOutcome, attemptReason,
        recordAttemptExpense ? Number(scooterAmount) : undefined, recordAttemptExpense ? cashbox : undefined);
      setClosingAttempt(null);
      setActiveTab('attempts');
      refreshNavBadges();
      await loadData();
    } catch (error) { toastError(error instanceof Error ? error.message : 'تعذر تسجيل المحاولة'); }
    finally { setIsSubmitting(false); }
  };

  const retryAttempt = async (shipment: Shipment) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await shippingService.retryAttempt(shipment.id);
      setActiveTab('active');
      refreshNavBadges();
      await loadData();
    } catch (error) { toastError(error instanceof Error ? error.message : 'تعذر إعادة المحاولة'); }
    finally { setIsSubmitting(false); }
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

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {isAuthorized && (
            <>
              <button
                type="button"
                onClick={() => handleOpenPackSelected(selectedOrderIds)}
                disabled={selectedOrderIds.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium transition shadow-sm"
              >
                <Package className="w-5 h-5" />
                <span>تجهيز طرد ({selectedOrderIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => void openPickup()}
                className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-2.5 font-medium text-teal-900 transition hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200 dark:hover:bg-teal-900"
              >
                طلب استلام من الطبيب
              </button>
            </>
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
            <div className="text-2xl font-bold text-slate-900 dark:text-white">{readyForPacking.length}</div>
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
      {(focusedOrderId || focusedAttemptId) && <button type="button" onClick={() => setParams({})}
        className="text-sm font-semibold text-cyan-700">عرض كل الشحنات والحالات</button>}
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
            جاهز لتجهيز الشحن ({readyForPacking.length} حالة)
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'active'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            الشحنات النشطة ({shipmentCaseCount(activeShipments)} حالة)
          </button>
          <button
            onClick={() => setActiveTab('delivered')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === 'delivered'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            سجل التسليمات ({shipmentCaseCount(deliveredShipments)} حالة)
          </button>
          <button type="button" onClick={() => setActiveTab('attempts')}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${activeTab === 'attempts' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
            المحاولات المقفولة ({closedAttempts.length})
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
                          handleOpenPackSelected(allGroupIds)
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
                                {order.route_override_id === MIXED_TRY_IN_ROUTE_ID && (
                                  <span className="rounded bg-cyan-50 px-2 py-0.5 text-xs text-cyan-900">
                                    {order.production_status === 'try_in_ready' ? 'شحن البروفة' : 'شحن النهائي'}
                                  </span>
                                )}
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
                                  handleOpenPackSelected([order.id])
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

      {activeTab === 'attempts' && (
        <section className="grid gap-3 md:grid-cols-2" aria-label="المحاولات المقفولة">
          {!visibleAttempts.length && <p>مفيش محاولات مقفولة.</p>}
          {visibleAttempts.map(shipment => {
            const next = shipments.find(item => item.retry_of === shipment.id);
            return <article key={shipment.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-bold">{shipment.shipment_code} · {shipment.status === 'failed' ? 'تعذّر التوصيل' : shipment.status === 'returned' ? 'مرتجع' : 'ملغاة'}</h2>
              <p className="text-sm">{shipment.doctor?.name} · {shipment.attempt_outcome_reason || shipment.notes || 'السبب غير مسجل'}</p>
              {shipment.orders?.map(link => <p key={link.id} className="text-xs">{link.order?.case_id}</p>)}
              {next ? <p className="text-sm">المحاولة التالية · {next.shipment_code}</p> : isAuthorized &&
                <button type="button" disabled={isSubmitting} onClick={() => void retryAttempt(shipment)}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">إعادة المحاولة</button>}
            </article>;
          })}
        </section>
      )}

      {closingAttempt && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3">
        <form role="dialog" aria-modal="true" aria-labelledby="attempt-title" onSubmit={closeAttempt}
          className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900">
          <h2 id="attempt-title" className="font-bold">نتيجة محاولة الشحن · {closingAttempt.shipment_code}</h2>
          <label className="block text-sm">النتيجة
            <select value={attemptOutcome} onChange={event => {
              const outcome = event.target.value;
              if (outcome === 'failed' || outcome === 'returned' || outcome === 'cancelled') setAttemptOutcome(outcome);
            }} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-800">
              <option value="failed">تعذّر التوصيل</option><option value="returned">مرتجع</option><option value="cancelled">إلغاء</option>
            </select>
          </label>
          <label className="block text-sm">السبب<textarea required maxLength={1000} value={attemptReason}
            onChange={event => setAttemptReason(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 dark:bg-slate-800" /></label>
          {closingAttempt.scooter_payment_pending && canUseCashDelivery && <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={recordAttemptExpense} onChange={event => setRecordAttemptExpense(event.target.checked)} />
            دفعت تكلفة المحاولة
          </label>}
          {recordAttemptExpense && <div className="grid grid-cols-2 gap-2 text-sm">
            <label>المبلغ<input required type="number" min="0.01" step="0.01" value={scooterAmount}
              onChange={event => setScooterAmount(event.target.value)} className="block w-full rounded-lg border p-2" /></label>
            <label>المحفظة<select required value={cashbox} onChange={event => setCashbox(event.target.value)} className="block w-full rounded-lg border p-2">
              <option value="">اختار المحفظة</option>{cashboxes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          </div>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={isSubmitting} onClick={() => setClosingAttempt(null)} className="rounded-lg border px-3 py-2">رجوع</button>
            <button disabled={isSubmitting || !attemptReason.trim()} className="rounded-lg bg-blue-600 px-3 py-2 text-white disabled:opacity-50">حفظ النتيجة</button>
          </div>
        </form>
      </div>}

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
                const awaitingLastMile = shipment.hub_leg && isDelivered && !completedHubIds.has(shipment.id);
                const previousLeg = shipment.previous_shipping_leg
                  ? shipments.find(item => item.id === shipment.previous_shipping_leg)
                  : undefined;

                const lastMileOrders = awaitingLastMile
                  ? (shipment.orders ?? []).filter(order => readyOrders.some(ready => ready.id === order.order_id)).map(order => order.order_id)
                  : [];


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
                              awaitingLastMile
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                : isDelivered
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : isDispatched
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            }`}
                          >
                            {awaitingLastMile
                              ? (lastMileOrders.length ? 'وصل العاشر · جاهز للمرحلة الأخيرة' : 'وصل العاشر · في انتظار التسليم للطبيب')
                              : isDelivered
                              ? (shipment.hub_leg ? 'تمت المرحلة الأولى' : 'تم التسليم')
                              : isDispatched
                              ? 'مع شركة الشحن'
                              : 'جاهز للاستلام'}
                          </span>
                        </div>
                        {shipment.retry_of && <p className="mt-1 text-xs">إعادة محاولة · {shipments.find(item => item.id === shipment.retry_of)?.shipment_code ?? 'محاولة سابقة'}</p>}
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
                        {shipment.hub_leg ? <span className="text-xs font-semibold">العاشر من رمضان · عبر ألف مسكن</span> : shipment.direction === 'to_lab' && <span className="text-xs font-semibold">استلام من الطبيب</span>}
                        {shipment.previous_shipping_leg && <span className="text-xs font-semibold">
                          المرحلة الأخيرة {previousLeg ? `· ${previousLeg.shipment_code}` : ''}
                        </span>}
                        {shipment.cash_carrier === 'middle_east' && <span className="text-xs font-semibold">ميدل إيست · كاش</span>}
                        {shipment.shipping_area && <span className="text-xs">{shipment.shipping_area}</span>}
                        {['admin', 'accountant', 'coordinator'].includes(role ?? '') && shipment.immediate_expense_id && (
                          <span className="text-xs font-semibold">
                            {shipment.cash_carrier === 'middle_east' ? 'ميدل إيست' : 'سكوتر'} · {shipment.cost_amount?.toLocaleString()} ج.م
                            {shipment.orders && shipment.orders.length > 1 && shipment.cost_amount != null &&
                              ` · متوسط ${(shipment.cost_amount / shipment.orders.length).toLocaleString(undefined, { maximumFractionDigits: 2 })} ج.م للأوردر`}
                          </span>
                        )}

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
                            {so.stage?.name_override && <span className="mr-2 font-semibold text-cyan-800">· {so.stage.name_override}</span>}
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

                    {previousLeg && canUseCashDelivery && (
                      <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                        <div><dt className="text-slate-500 dark:text-slate-400">شركة الشحن · ألف مسكن</dt>
                          <dd className="mt-1 font-semibold">{previousLeg.base_shipping_cost == null ? 'السعر غير محدد' : `${previousLeg.base_shipping_cost.toLocaleString()} ج.م · أساسي`}</dd></div>
                        <div><dt className="text-slate-500 dark:text-slate-400">{shipment.cash_carrier ? 'السكوتر' : 'التوصيل الشخصي'}</dt>
                          <dd className="mt-1 font-semibold">{shipment.cash_carrier
                            ? (shipment.cost_amount == null ? 'في انتظار تسجيل المصروف' : `${shipment.cost_amount.toLocaleString()} ج.م`)
                            : 'بدون مصروف إضافي'}</dd></div>
                      </dl>
                    )}

                    {isAuthorized && lastMileOrders.length > 0 && (
                      <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
                        <button type="button" onClick={() => handleOpenPackSelected(lastMileOrders, true)}
                          className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                          تجهيز المرحلة الأخيرة
                        </button>
                      </div>
                    )}

                    {/* Actions for Active Shipments */}
                    {!isDelivered && isAuthorized && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setClosingAttempt(shipment); setAttemptOutcome('failed'); setAttemptReason('');
                            setRecordAttemptExpense(false); setScooterAmount(''); setCashbox('');
                            if (shipment.scooter_payment_pending && canUseCashDelivery) {
                              void financeService.getCashboxes(true).then(setCashboxes).catch(() => toastError('تعذر تحميل المحافظ'));
                            }
                          }}
                          className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition font-medium"
                        >
                          فشل / مرتجع / إلغاء
                        </button>
                        {!isDispatched && (shipment.direction !== 'to_lab' || shipment.hub_leg) && (
                          <button
                            onClick={() => handleDispatch(shipment)}
                            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium shadow-sm"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{shipment.previous_shipping_leg && !shipment.cash_carrier ? 'بدء التوصيل الشخصي' : 'تسليم للمندوب'}</span>
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedShipmentForDelivery(shipment);
                            setScooterAmount(''); setCashbox('');
                            if (shipment.scooter_payment_pending) void financeService.getCashboxes(true).then(setCashboxes).catch(() => toastError('تعذر تحميل المحافظ'));
                            setIsDeliveryModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-medium shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{shipment.hub_leg ? 'تأكيد الوصول للعاشر' : shipment.direction === 'to_lab' ? 'تأكيد الوصول للمعمل' : 'تأكيد التسليم'}</span>
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
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3 sm:p-5">
          <div role="dialog" aria-modal="true" aria-labelledby="shipment-create-title" className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-lg">
                <Package className="w-5 h-5 text-blue-600" />
                <h2 id="shipment-create-title">{lastMile ? 'تجهيز المرحلة الأخيرة' : direction === 'to_lab' ? 'طلب استلام من الطبيب' : 'تجهيز وإغلاق طرد شحن'}</h2>
              </div>
              <button
                aria-label="إغلاق"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateShipment} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
              {direction === 'to_doctor' && <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  الأوردرات المختارة ({selectedOrderIds.length})
                  {lastMile && <span className="text-blue-700 dark:text-blue-300">{formArea}</span>}
                </div>
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
              </div>}

              {direction === 'to_lab' && <div className="space-y-2 rounded-xl border p-3">
                <label className="block">العيادة<select className="block w-full rounded border p-2" required value={pickupDoctor}
                  onChange={event => choosePickupClinic(event.target.value, '')}>
                  <option value="">اختار الطبيب</option>
                  {clinics.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
                {!!clinics.find(item => item.id === pickupDoctor)?.branches?.length && <label className="block">الفرع
                  <select className="block w-full rounded border p-2" value={pickupBranch} onChange={event => choosePickupClinic(pickupDoctor, event.target.value)}>
                    <option value="">العنوان الرئيسي</option>
                    {clinics.find(item => item.id === pickupDoctor)?.branches?.map(item => <option key={item.id}>{item.name}</option>)}
                  </select>
                </label>}
                <label className="flex gap-2"><input type="checkbox" checked={newCase} onChange={event => { setNewCase(event.target.checked); setSelectedOrderIds([]); }} /> مقاس لحالة جديدة</label>
                {newCase ? <label className="block">اسم المريض<input required className="block w-full rounded border p-2" value={newPatient}
                  onChange={event => setNewPatient(event.target.value)} /></label> : <label className="block">الأوردرات المرتبطة<select multiple className="block w-full rounded border p-2" value={selectedOrderIds}
                  onChange={event => setSelectedOrderIds(Array.from(event.target.selectedOptions, item => item.value))}>
                  {pickupOrders.filter(item => (item.branchName || '') === pickupBranch).map(item =>
                    <option key={item.id} value={item.id}>{item.caseId} · {item.patientName}</option>)}
                </select></label>}
              </div>}
              {!lastMile && <label className="block text-sm font-medium">منطقة الشحن
                <ShippingAreaSelect value={formArea} onChange={setFormArea} />
              </label>}
              {lastMile && <fieldset>
                <legend className="mb-2 text-sm font-semibold">طريقة التوصيل</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(canUseCashDelivery ? ['scooter', 'self'] : ['self']).map(method => {
                    const checked = scooter === (method === 'scooter');
                    return <label key={method} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${checked
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-700'}`}>
                      <input type="radio" name="last-mile-method" checked={checked} onChange={() => {
                        setScooter(method === 'scooter'); setExpenseId(''); setCreateExpense(true);
                      }} />
                      <span>{method === 'scooter' ? 'سكوتر' : 'هوصلها بنفسي · بدون مصروف'}</span>
                    </label>;
                  })}
                </div>
              </fieldset>}
              {!lastMile && canUseCashDelivery && <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={scooter} onChange={event => void selectScooter(event.target.checked)} /> توصيل بسداد فوري
              </label>}
              {!lastMile && !scooter && direction === 'to_doctor' && formArea === 'العاشر من رمضان' && <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={hubLeg} onChange={event => setHubLeg(event.target.checked)} /> المرحلة الأولى للعاشر عبر ألف مسكن
              </label>}
              {scooter && !lastMile && <label className="block text-sm">وسيلة الشحن الكاش
                <select className="block w-full rounded-xl border p-2" value={cashCarrier}
                  onChange={event => setCashCarrier(event.target.value === 'middle_east' ? 'middle_east' : 'scooter')}>
                  <option value="scooter">سكوتر</option><option value="middle_east">ميدل إيست</option>
                </select>
              </label>}
              {scooter && <label className="block text-sm">طريقة السداد الفوري
                <select className="block w-full rounded-xl border p-2" value={createExpense ? 'new' : 'existing'}
                  onChange={event => { const create = event.target.value === 'new'; setCreateExpense(create); if (!create) void selectScooter(true); }}>
                  <option value="new">إنشاء مصروف عند الوصول</option><option value="existing">ربط بمصروف موجود</option>
                </select>
              </label>}
              {scooter && !createExpense && <label className="block text-sm">مصروف الشحن المسجل في المالية
                <select className="block w-full rounded-xl border p-2" required value={expenseId} onChange={event => setExpenseId(event.target.value)}>
                  <option value="">اختار المصروف</option>
                  {expenses.map(item => <option key={item.id} value={item.id}>{item.description} · {item.amount} ج.م</option>)}
                </select>
              </label>}
              {!lastMile && !scooter && <div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    شركة الشحن / المندوب
                  </label>
                  <select
                    value={scooter ? '' : formCourierId}
                    disabled={scooter || lastMile}
                    required={!scooter && (direction === 'to_lab' || (formArea === 'العاشر من رمضان' && hubLeg))}
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
              </div>}

              <details className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                <summary className="cursor-pointer text-sm font-semibold">تفاصيل اختيارية</summary>
                <div className="mt-3 space-y-3">
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

              {direction === 'to_doctor' && <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="shipment-recipient" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    اسم المستلم (الطبيب/العيادة)
                  </label>
                  <input
                    type="text"
                    id="shipment-recipient"
                    value={formRecipientName}
                    onChange={e => setFormRecipientName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="shipment-phone" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    id="shipment-phone"
                    type="tel"
                    value={formRecipientPhone}
                    onChange={e => setFormRecipientPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="shipment-address" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  عنوان التسليم
                </label>
                <input
                  type="text"
                  id="shipment-address"
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

              </>}
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

                </div>
              </details>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
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
                    <span>{lastMile ? 'حفظ المرحلة الأخيرة' : direction === 'to_lab' ? 'حفظ طلب الاستلام' : 'تأكيد التغليف'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delivery */}
      {isDeliveryModalOpen && selectedShipmentForDelivery && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3 sm:p-5">
          <div role="dialog" aria-modal="true" aria-labelledby="shipment-delivery-title" className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <h2 id="shipment-delivery-title">{selectedShipmentForDelivery.hub_leg ? 'تأكيد الوصول للعاشر'
                  : selectedShipmentForDelivery.direction === 'to_lab' ? 'تأكيد الوصول للمعمل'
                  : isTrialOnlyShipment ? 'تأكيد وصول البروفة للطبيب' : 'تأكيد التسليم للطبيب'}</h2>
              </div>
              <button
                aria-label="إغلاق"
                onClick={() => setIsDeliveryModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmDelivery} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                <div className="font-semibold">الشحنة: {selectedShipmentForDelivery.shipment_code}</div>
                <div>المستلم: {selectedShipmentForDelivery.recipient_name || selectedShipmentForDelivery.doctor?.name}</div>
                <div>عدد الحالات المشمولة: {selectedShipmentForDelivery.orders?.length || 0}</div>
              </div>

              {selectedShipmentForDelivery.scooter_payment_pending && <div className="grid gap-3 sm:grid-cols-2">
                <label>مبلغ السكوتر<input required type="number" min="0.01" step="0.01" className="block w-full rounded border p-2" value={scooterAmount} onChange={e => setScooterAmount(e.target.value)} /></label>
                <label>محفظة السداد<select required className="block w-full rounded border p-2" value={cashbox} onChange={e => setCashbox(e.target.value)}>
                  <option value="">اختار المحفظة</option>{cashboxes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select></label>
              </div>}
              <details className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
                <summary className="cursor-pointer text-sm font-semibold">ملاحظات وإثبات الاستلام</summary>
                <div className="mt-3 space-y-3">
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

                </div>
              </details>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
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
                  {isSubmitting ? 'جاري التأكيد...' : selectedShipmentForDelivery.hub_leg
                    ? 'تأكيد الوصول للعاشر' : selectedShipmentForDelivery.direction === 'to_lab'
                    ? 'تأكيد الوصول للمعمل' : 'تأكيد التسليم'}
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
