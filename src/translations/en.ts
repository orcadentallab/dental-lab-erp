// English translations
export const en = {
    // Common
    common: {
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        edit: 'Edit',
        add: 'Add',
        search: 'Search',
        filter: 'Filter',
        export: 'Export',
        print: 'Print',
        close: 'Close',
        confirm: 'Confirm',
        yes: 'Yes',
        no: 'No',
        loading: 'Loading...',
        noData: 'No data available',
        actions: 'Actions',
        status: 'Status',
        date: 'Date',
        notes: 'Notes',
        total: 'Total',
        amount: 'Amount',
        name: 'Name',
        phone: 'Phone',
        email: 'Email',
        address: 'Address',
        from: 'From',
        to: 'To',
        all: 'All',
        details: 'Details',
        view: 'View',
        back: 'Back',
        next: 'Next',
        previous: 'Previous',
        success: 'Success',
        error: 'Error occurred',
        warning: 'Warning',
        register: 'Register',
        registered: 'Registered',
        unregistered: 'Unregistered',
        urgent: 'Urgent',
        delayed: 'Delayed',
        type: 'Type',
        description: 'Description',
        egp: 'EGP',
    },

    // Navigation
    nav: {
        dashboard: 'Dashboard',
        orders: 'Orders',
        doctors: 'Doctors',
        finance: 'Finance',
        accounts: 'Accounts',
        suppliers: 'Suppliers',
        staff: 'Staff',
        users: 'Users',
        analytics: 'Analytics',
        quality: 'Quality',
        settings: 'Settings',
        caseRegistration: 'Case Registration',
        logout: 'Logout',
    },

    // Header
    header: {
        systemTitle: 'Lab Management System',
        darkMode: 'Switch to Dark Mode',
        lightMode: 'Switch to Light Mode',
        language: 'Language',
    },

    // Dashboard
    dashboard: {
        title: 'Dashboard',
        welcome: 'Welcome',
        activeOrders: 'Active Orders',
        todayOrders: "Today's Orders",
        readyForDelivery: 'Ready for Delivery',

        // Alerts
        importantAlerts: 'Important Alerts',
        workflowTracking: 'Workflow Tracking',
        financialActions: 'Financial & Administrative Actions',

        // Alert Cards
        rejectedReturned: 'Rejected/Returned Cases',
        overdueOrders: 'Overdue Cases',
        needsAttention: 'Needs Attention (PMMA/Details)',
        unassignedLab: 'Unassigned Lab Cases',
        pendingApproval: 'Pending Lab/Designer Approval',
        designPhase: 'In Design/Approval Phase',
        tryInWaiting: 'Try-In Awaiting Doctor Response',
        unregisteredOrders: 'Unregistered Orders',

        // Lab Section
        labWorkload: 'Lab Workload',

        // Quick Actions
        newOrder: 'New Order',
        newDoctor: 'New Doctor',
        accountStatement: 'Account Statement',
        recordExpense: 'Record Expense',

        // Designer
        designerDashboard: 'Designer Dashboard',
        pendingCases: 'New Cases - Awaiting Response',
        inProgress: 'Cases Under Design',
        waitingApproval: 'Cases Awaiting Doctor Approval',
        returnedCases: 'Returned Cases - Need Adjustment',
        noCasesAssigned: 'No cases currently assigned to you',
        casesWillAppear: 'Cases will appear here when assigned by management.',

        // Lab
        labDashboard: 'Lab Dashboard',
        inProduction: 'Cases in Production',
        delayedCases: 'Delayed Cases',
        rejectedCases: 'Rejected/Returned',
        readyToday: 'Ready Today',
        tryInApproved: 'Try-In Approved - Execute Final Required',
        pendingConfirmation: 'Pending Confirmation',
        acceptOrReject: 'Please accept or reject these new cases to confirm starting work.',
        goToRespond: 'Go to Respond',
        requiresAttention: 'Urgent & Delayed Cases',
        allActiveCases: 'All Active Cases',
        noActiveCases: 'No active cases currently',
        rejectedReturnedCases: 'Rejected / Returned Cases',
        accountNotLinked: 'Account Not Linked to Lab',
        accountNotLinkedDesc: 'This user is not linked to any external lab (Supplier). Please contact admin to link the account.',

        // Everything OK
        allGood: 'Everything is running smoothly!',
        noOrdersNeedAttention: 'No orders need attention',
    },

    // Orders
    orders: {
        title: 'Orders',
        newOrder: 'New Order',
        caseId: 'Case ID',
        patient: 'Patient',
        patientName: 'Patient Name',
        doctor: 'Doctor',
        lab: 'Lab',
        internalLab: 'Internal Lab',
        designer: 'Designer',
        services: 'Services',
        deliveryDate: 'Delivery Date',
        orderDate: 'Order Date',
        priority: 'Priority',
        workflow: 'Workflow Type',
        teethNumbers: 'Teeth Numbers',
        shade: 'Shade',
        material: 'Material',

        // Status
        status: {
            newCase: 'New Case',
            underDesign: 'Under Design',
            waitingApproval: 'Waiting Approval',
            underProduction: 'Under Production',
            tryIn: 'Try In',
            tryInApproved: 'Try-In Approved',
            ready: 'Ready',
            delivered: 'Delivered',
            returnedForAdjustments: 'Returned',
            rejected: 'Rejected',
        },

        // Priority
        priorityOptions: {
            normal: 'Normal',
            urgent: 'Urgent',
        },

        // Workflow
        workflowOptions: {
            full: 'Full',
            split: 'Split',
        },

        // Delivery Type
        deliveryType: {
            final: 'Final',
            tryIn: 'Try In',
        },

        // Actions
        accept: 'Accept',
        reject: 'Reject',
        assignLab: 'Assign Lab',
        assignDesigner: 'Assign Designer',
        updateStatus: 'Update Status',
        addComment: 'Add Comment',
        viewDetails: 'View Details',

        // Messages
        hidden: 'Hidden',
        notAssigned: 'Not Assigned',
    },

    // Doctors
    doctors: {
        title: 'Doctors',
        newDoctor: 'Add Doctor',
        doctorName: 'Doctor Name',
        clinic: 'Clinic',
        specialty: 'Specialty',
        representative: 'Representative',
        totalOrders: 'Total Orders',
        balance: 'Balance',
        creditLimit: 'Credit Limit',
        priceList: 'Price List',
        discount: 'Discount',
    },

    // Finance
    finance: {
        title: 'Finance',
        income: 'Income',
        expense: 'Expense',
        payment: 'Payment',
        receipt: 'Receipt',
        invoice: 'Invoice',

        // Tabs
        services: 'Services',
        transactions: 'Transactions',
        expenses: 'Expenses',

        // Transaction Types
        doctorPayment: 'Doctor Payment',
        supplierPayment: 'Supplier Payment',
        generalExpense: 'General Expense',

        // Expense Categories
        expenseCategories: {
            materials: 'Materials',
            salaries: 'Salaries',
            rent: 'Rent',
            utilities: 'Utilities',
            equipment: 'Equipment',
            maintenance: 'Maintenance',
            transportation: 'Transportation',
            other: 'Other',
        },
    },

    // Accounts
    accounts: {
        title: 'Account Statement',
        doctorAccounts: 'Doctor Accounts',
        supplierAccounts: 'Supplier Accounts',
        accountStatement: 'Account Statement',
        balance: 'Balance',
        debit: 'Debit',
        credit: 'Credit',
        openingBalance: 'Opening Balance',
        closingBalance: 'Closing Balance',
    },

    // Suppliers
    suppliers: {
        title: 'Suppliers',
        newSupplier: 'Add Supplier',
        supplierName: 'Supplier Name',
        contactPerson: 'Contact Person',
        activeOrders: 'Active Orders',
        totalBalance: 'Total Balance',
    },

    // Staff
    staff: {
        title: 'Staff',
        newEmployee: 'Add Employee',
        employeeName: 'Employee Name',
        position: 'Position',
        department: 'Department',
        salary: 'Salary',
        joinDate: 'Join Date',
        attendance: 'Attendance',
        advances: 'Advances',
        deductions: 'Deductions',
        bonuses: 'Bonuses',
    },

    // Users
    users: {
        title: 'Users',
        newUser: 'Add User',
        username: 'Username',
        password: 'Password',
        role: 'Role',
        linkedEntity: 'Linked Entity',

        roles: {
            admin: 'Admin',
            representative: 'Representative',
            accountant: 'Accountant',
            designer: 'Designer',
            lab: 'Lab',
        },
    },

    // Settings
    settings: {
        title: 'Settings',
        general: 'General',
        backup: 'Backup',
        restore: 'Restore',
        export: 'Export Data',
        import: 'Import Data',
        changePassword: 'Change Password',
        currentPassword: 'Current Password',
        newPassword: 'New Password',
        confirmPassword: 'Confirm Password',
    },

    // Analytics
    analytics: {
        title: 'Reports & Analytics',
        overview: 'Overview',
        orderStats: 'Order Statistics',
        revenueStats: 'Revenue Statistics',
        labPerformance: 'Lab Performance',
        doctorStats: 'Doctor Statistics',
        monthlyReport: 'Monthly Report',
        dateRange: 'Date Range',
    },

    // Quality
    quality: {
        title: 'Quality Management',
        qualityChecks: 'Quality Checks',
        issues: 'Issues',
        returns: 'Returns',
        returnRate: 'Return Rate',
        qualityScore: 'Quality Score',
    },

    // Login
    login: {
        title: 'Login',
        username: 'Username',
        password: 'Password',
        loginButton: 'Login',
        loggingIn: 'Logging in...',
        invalidCredentials: 'Invalid username or password',
        systemName: 'Dental Lab Management System',
    },

    // Table Headers
    table: {
        caseNumber: 'Case#',
        patient: 'Patient',
        doctor: 'Doctor',
        services: 'Services',
        delivery: 'Delivery',
        status: 'Status',
        action: 'Action',
        labDesigner: 'Lab/Designer',
        comments: 'Latest Comments',
    },

    // Registration
    registration: {
        title: 'Case Registration',
        pending: 'Pending Registration',
        history: 'Registration History',
        markAsRegistered: 'Mark as Registered',
        rejectionCost: 'Rejection Cost',
        changesDetected: 'Changes Detected (Needs Re-registration)',
        salePrice: 'Sale Price',
        costPrice: 'Cost Price',
        patientName: 'Patient Name',
        doctor: 'Doctor',
        services: 'Services',
        caseId: 'Case ID',
        externalLab: 'External Lab',
        internalLab: 'Internal Lab',
        status: 'Status',
    },
};

export type TranslationKeys = typeof en;
