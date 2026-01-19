// Arabic translations - اللغة العربية
export const ar = {
    // Common / عام
    common: {
        save: 'حفظ',
        cancel: 'إلغاء',
        delete: 'حذف',
        edit: 'تعديل',
        add: 'إضافة',
        search: 'بحث',
        filter: 'فلترة',
        export: 'تصدير',
        print: 'طباعة',
        close: 'إغلاق',
        confirm: 'تأكيد',
        yes: 'نعم',
        no: 'لا',
        loading: 'جاري التحميل...',
        noData: 'لا توجد بيانات',
        actions: 'الإجراءات',
        status: 'الحالة',
        date: 'التاريخ',
        notes: 'ملاحظات',
        total: 'الإجمالي',
        amount: 'المبلغ',
        name: 'الاسم',
        phone: 'الهاتف',
        email: 'البريد الإلكتروني',
        address: 'العنوان',
        from: 'من',
        to: 'إلى',
        all: 'الكل',
        details: 'التفاصيل',
        view: 'عرض',
        back: 'رجوع',
        next: 'التالي',
        previous: 'السابق',
        success: 'تم بنجاح',
        error: 'حدث خطأ',
        warning: 'تحذير',
        register: 'تسجيل',
        registered: 'مسجل',
        unregistered: 'غير مسجل',
        urgent: 'عاجل',
        delayed: 'متأخر',
        type: 'النوع',
        description: 'الوصف',
        egp: 'ج.م',
    },

    // Navigation / القائمة الجانبية
    nav: {
        dashboard: 'لوحة التحكم',
        orders: 'الأوردرات',
        doctors: 'الأطباء',
        finance: 'المالية',
        accounts: 'كشف الحساب',
        suppliers: 'الموردين',
        staff: 'الموظفين',
        users: 'المستخدمين',
        analytics: 'التقارير',
        quality: 'الجودة',
        settings: 'الإعدادات',
        logout: 'تسجيل الخروج',
    },

    // Header / الهيدر
    header: {
        systemTitle: 'نظام إدارة المعمل',
        darkMode: 'تحويل للوضع الليلي',
        lightMode: 'تحويل للوضع النهاري',
        language: 'اللغة',
    },

    // Dashboard / لوحة التحكم
    dashboard: {
        title: 'لوحة التحكم',
        welcome: 'أهلاً بك',
        activeOrders: 'نشط حالياً',
        todayOrders: 'أوردرات اليوم',
        readyForDelivery: 'جاهز للتسليم',

        // Alerts
        importantAlerts: 'تنبيهات هامة',
        workflowTracking: 'متابعة سير العمل',
        financialActions: 'إجراءات مالية وإدارية',

        // Alert Cards
        rejectedReturned: 'حالات مرفوضة/مرتجعة',
        overdueOrders: 'حالات متأخرة',
        needsAttention: 'مطلوب انتباه (PMMA/تفاصيل)',
        unassignedLab: 'حالات بدون معمل',
        pendingApproval: 'حالات منتظرة موافقة المعمل/المصمم',
        designPhase: 'في مرحلة التصميم/الموافقة',
        tryInWaiting: 'Try-In منتظر رد الطبيب',
        unregisteredOrders: 'أوردرات غير مسجلة',

        // Lab Section
        labWorkload: 'حمل المعامل',

        // Quick Actions
        newOrder: 'أوردر جديد',
        newDoctor: 'طبيب جديد',
        accountStatement: 'كشف حساب',
        recordExpense: 'تسجيل مصروف',

        // Designer
        designerDashboard: 'لوحة تحكم المصمم',
        pendingCases: 'حالات جديدة - منتظر الرد',
        inProgress: 'حالات تحت التصميم',
        waitingApproval: 'حالات انتظار موافقة الطبيب',
        returnedCases: 'حالات مرتجعة - تحتاج تعديل',
        noCasesAssigned: 'لا توجد حالات مسندة إليك حالياً',
        casesWillAppear: 'ستظهر هنا الحالات عند إسنادها من قبل الإدارة.',

        // Lab
        labDashboard: 'لوحة تحكم المعمل',
        inProduction: 'حالات قيد التنفيذ',
        delayedCases: 'حالات متأخرة',
        rejectedCases: 'مرفوضة/مرتجع',
        readyToday: 'جاهز اليوم',
        tryInApproved: 'حالات "بروفة موافق" - مطلوب تنفيذ Final',
        pendingConfirmation: 'حالات بانتظار الرد',
        acceptOrReject: 'يرجى قبول أو رفض هذه الحالات الجديدة لتأكيد البدء فيها.',
        goToRespond: 'الذهاب للرد',
        requiresAttention: 'حالات عاجلة ومتأخرة',
        allActiveCases: 'كل الحالات الجارية',
        noActiveCases: 'لا توجد حالات جارية حالياً',
        rejectedReturnedCases: 'حالات مرفوضة / مرتجعة',
        accountNotLinked: 'حساب غير مرتبط بمعمل',
        accountNotLinkedDesc: 'هذا المستخدم غير مرتبط بأي معمل خارجي (Supplier). يرجى مراجعة المسؤول لربط الحساب.',

        // Everything OK
        allGood: 'كل شيء يسير بشكل رائع!',
        noOrdersNeedAttention: 'لا توجد أوردرات تحتاج إلى اهتمام',
    },

    // Orders / الأوردرات
    orders: {
        title: 'الأوردرات',
        newOrder: 'أوردر جديد',
        caseId: 'رقم الحالة',
        patient: 'المريض',
        patientName: 'اسم المريض',
        doctor: 'الطبيب',
        lab: 'المعمل',
        designer: 'المصمم',
        services: 'الخدمات',
        deliveryDate: 'تاريخ التسليم',
        orderDate: 'تاريخ الأوردر',
        priority: 'الأولوية',
        workflow: 'نوع العملية',
        teethNumbers: 'أرقام الأسنان',
        shade: 'اللون',
        material: 'الخامة',

        // Status
        status: {
            newCase: 'جديد',
            underDesign: 'تصميم',
            waitingApproval: 'موافقة',
            underProduction: 'إنتاج',
            tryIn: 'تجربة',
            tryInApproved: 'بروفة موافق',
            ready: 'جاهز',
            delivered: 'تم التسليم',
            returnedForAdjustments: 'مرتجع',
            rejected: 'مرفوض',
        },

        // Priority
        priorityOptions: {
            normal: 'عادي',
            urgent: 'عاجل',
        },

        // Workflow
        workflowOptions: {
            full: 'كامل',
            split: 'منفصل',
        },

        // Delivery Type
        deliveryType: {
            final: 'Final',
            tryIn: 'Try In',
        },

        // Actions
        accept: 'قبول',
        reject: 'رفض',
        assignLab: 'تحديد معمل',
        assignDesigner: 'تحديد مصمم',
        updateStatus: 'تحديث الحالة',
        addComment: 'إضافة تعليق',
        viewDetails: 'عرض التفاصيل',

        // Messages
        hidden: 'مخفي',
        notAssigned: 'غير محدد',
    },

    // Doctors / الأطباء
    doctors: {
        title: 'الأطباء',
        newDoctor: 'إضافة طبيب',
        doctorName: 'اسم الطبيب',
        clinic: 'العيادة',
        specialty: 'التخصص',
        representative: 'المندوب',
        totalOrders: 'إجمالي الأوردرات',
        balance: 'الرصيد',
        creditLimit: 'حد الائتمان',
        priceList: 'قائمة الأسعار',
        discount: 'الخصم',
    },

    // Finance / المالية
    finance: {
        title: 'المالية',
        income: 'إيرادات',
        expense: 'مصروفات',
        payment: 'دفعة',
        receipt: 'إيصال',
        invoice: 'فاتورة',

        // Tabs
        services: 'الخدمات',
        transactions: 'المعاملات',
        expenses: 'المصروفات',

        // Transaction Types
        doctorPayment: 'دفعة من طبيب',
        supplierPayment: 'دفعة لمورد',
        generalExpense: 'مصروف عام',

        // Expense Categories
        expenseCategories: {
            materials: 'خامات',
            salaries: 'مرتبات',
            rent: 'إيجار',
            utilities: 'مرافق',
            equipment: 'معدات',
            maintenance: 'صيانة',
            transportation: 'مواصلات',
            other: 'أخرى',
        },
    },

    // Accounts / كشف الحساب
    accounts: {
        title: 'كشف الحساب',
        doctorAccounts: 'حسابات الأطباء',
        supplierAccounts: 'حسابات الموردين',
        accountStatement: 'كشف الحساب',
        balance: 'الرصيد',
        debit: 'مدين',
        credit: 'دائن',
        openingBalance: 'رصيد افتتاحي',
        closingBalance: 'رصيد ختامي',
    },

    // Suppliers / الموردين
    suppliers: {
        title: 'الموردين',
        newSupplier: 'إضافة مورد',
        supplierName: 'اسم المورد',
        contactPerson: 'جهة الاتصال',
        activeOrders: 'الأوردرات النشطة',
        totalBalance: 'إجمالي الرصيد',
    },

    // Staff / الموظفين
    staff: {
        title: 'الموظفين',
        newEmployee: 'إضافة موظف',
        employeeName: 'اسم الموظف',
        position: 'المنصب',
        department: 'القسم',
        salary: 'الراتب',
        joinDate: 'تاريخ التعيين',
        attendance: 'الحضور',
        advances: 'السلف',
        deductions: 'الخصومات',
        bonuses: 'المكافآت',
    },

    // Users / المستخدمين
    users: {
        title: 'المستخدمين',
        newUser: 'إضافة مستخدم',
        username: 'اسم المستخدم',
        password: 'كلمة المرور',
        role: 'الصلاحية',
        linkedEntity: 'الكيان المرتبط',

        roles: {
            admin: 'مدير النظام',
            representative: 'مندوب',
            accountant: 'محاسب',
            designer: 'مصمم',
            lab: 'معمل',
        },
    },

    // Settings / الإعدادات
    settings: {
        title: 'الإعدادات',
        general: 'عام',
        backup: 'النسخ الاحتياطي',
        restore: 'استعادة',
        export: 'تصدير البيانات',
        import: 'استيراد البيانات',
        changePassword: 'تغيير كلمة المرور',
        currentPassword: 'كلمة المرور الحالية',
        newPassword: 'كلمة المرور الجديدة',
        confirmPassword: 'تأكيد كلمة المرور',
    },

    // Analytics / التقارير
    analytics: {
        title: 'التقارير والإحصائيات',
        overview: 'نظرة عامة',
        orderStats: 'إحصائيات الأوردرات',
        revenueStats: 'إحصائيات الإيرادات',
        labPerformance: 'أداء المعامل',
        doctorStats: 'إحصائيات الأطباء',
        monthlyReport: 'التقرير الشهري',
        dateRange: 'الفترة الزمنية',
    },

    // Quality / الجودة
    quality: {
        title: 'إدارة الجودة',
        qualityChecks: 'فحوصات الجودة',
        issues: 'المشاكل',
        returns: 'المرتجعات',
        returnRate: 'نسبة الإرجاع',
        qualityScore: 'درجة الجودة',
    },

    // Login / تسجيل الدخول
    login: {
        title: 'تسجيل الدخول',
        username: 'اسم المستخدم',
        password: 'كلمة المرور',
        loginButton: 'دخول',
        loggingIn: 'جاري الدخول...',
        invalidCredentials: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        systemName: 'نظام إدارة معمل الأسنان',
    },

    // Table Headers / عناوين الجداول
    table: {
        caseNumber: 'Case#',
        patient: 'المريض',
        doctor: 'الطبيب',
        services: 'الخدمات',
        delivery: 'التسليم',
        status: 'الحالة',
        action: 'الإجراء',
        labDesigner: 'المعمل/المصمم',
        comments: 'آخر ملاحظات',
    },
};

export type TranslationKeys = typeof ar;
