import type {
  ClassTuitionClassStatus,
  ClassTuitionEnrollmentStatus,
  ClassTuitionReconciliationResponse,
  ClassTuitionRowFilter,
  ClassTuitionStudentRow,
  ClassTuitionWarningCode,
} from '../../../../../shared/classTuitionReconciliation';

export type ClassTuitionReconciliationText = {
  title: string;
  subtitle: string;
  wholeCourseScope: string;
  classLabel: string;
  classSearch: string;
  noClassMatches: string;
  clearClass: string;
  studentSearch: string;
  courseLabel: string;
  selectCourse: string;
  currentCourse: string;
  loadingClasses: string;
  loadingCourses: string;
  loadingReport: string;
  noCourses: string;
  noRows: string;
  noMatches: string;
  retry: string;
  loadError: string;
  tooLarge: string;
  incompleteData: string;
  kpis: Record<
    | 'expectedGross'
    | 'recordedGross'
    | 'reductionTotal'
    | 'netDueTotal'
    | 'paidTotal'
    | 'outstandingTotal'
    | 'overpaidTotal'
    | 'missingLedgerCount'
    | 'warningRowCount',
    string
  >;
  filters: Record<ClassTuitionRowFilter, string>;
  columns: Record<
    | 'student'
    | 'enrollment'
    | 'gross'
    | 'reduction'
    | 'netDue'
    | 'paid'
    | 'outstanding'
    | 'warnings'
    | 'actions',
    string
  >;
  warningLabels: Record<ClassTuitionWarningCode, string>;
  statusLabels: Record<ClassTuitionEnrollmentStatus, string>;
  classStatusLabels: Record<ClassTuitionClassStatus, string>;
  unknownStudent: string;
  orphanLedger: string;
  expectedBadge: string;
  viewDetails: string;
  detail: {
    title: string;
    loading: string;
    emptyAllocations: string;
    retry: string;
    close: string;
    enrollments: string;
    ledgers: string;
    allocations: string;
    gross: string;
    reduction: string;
    netDue: string;
    paid: string;
    outstanding: string;
    overpaid: string;
    receiptNo: string;
    receivedDate: string;
    paymentMethod: string;
    allocatedAmount: string;
    discountAmount: string;
    discountType: string;
    unclassifiedDiscount: string;
    note: string;
    openWorkspace: string;
    unknownPaymentMethod: string;
  };
};

export type ClassTuitionReconciliationViewProps = {
  report: ClassTuitionReconciliationResponse;
  search: string;
  filter: ClassTuitionRowFilter;
  language: 'vi' | 'en';
  t: ClassTuitionReconciliationText;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: ClassTuitionRowFilter) => void;
  onViewDetails: (row: ClassTuitionStudentRow) => void;
};

export type FinanceReportText = {
  title: string;
  subtitle: string;
  month: string;
  trendLength: string;
  loading: string;
  noData: string;
  tooLarge: string;
  backToDashboard: string;
  openWorkspace: string;
  kpi: {
    projected: string;
    collected: string;
    outstanding: string;
    discount: string;
    waiver: string;
    unclassified: string;
    spent: string;
    fundBalance: string;
  };
  details: {
    viewDetails: string;
    incomeTitle: string;
    expenseTitle: string;
    transactionCount: string;
    totalAmount: string;
    loading: string;
    emptyIncome: string;
    emptyExpense: string;
    loadError: string;
    retry: string;
    close: string;
    previousPage: string;
    nextPage: string;
    page: string;
    notAvailable: string;
    heldInWallet: string;
    showAllocations: string;
    hideAllocations: string;
    methods: Record<string, string>;
    categories: Record<string, string>;
    income: {
      receiptNo: string;
      invoiceNo: string;
      receivedDate: string;
      student: string;
      phone: string;
      className: string;
      paymentMethod: string;
      amountReceived: string;
      amountDue: string;
      remainingAmount: string;
      walletBalance: string;
      allocatedAmount: string;
    };
    expense: {
      expenseNo: string;
      paidDate: string;
      category: string;
      content: string;
      amount: string;
      payee: string;
      createdBy: string;
      student: string;
      className?: string;
    };
  };
  waterfall: {
    title: string;
    gross: string;
    totalDiscount: string;
    projected: string;
    collected: string;
    outstanding: string;
  };
  trend: {
    title: string;
    projected: string;
    collected: string;
    spent: string;
  };
  incomeByLevel: string;
  expensesByCategory: string;
  receivablesByStatus: string;
  receivableCount: string;
  statusLabels: Record<string, string>;
  students: {
    title: string;
    subtitle: string;
    totalStudents: string;
    paidStudents: string;
    withOutstanding: string;
    unpaidStudents: string;
    overdueStudents: string;
    all: string;
    search: string;
    searchPlaceholder: string;
    noMatches: string;
    student: string;
    fullName: string;
    studentCode: string;
    dateOfBirth: string;
    phone: string;
    course: string;
    className: string;
    teacher: string;
    courseDetails: string;
    moreCourses: string;
    status: string;
    billedAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    overdueAmount: string;
    overdue: string;
    ledgerCount: string;
    actions: string;
    viewDetails: string;
    detailTitle: string;
    close: string;
    unknownStudent: string;
    notAvailable: string;
    page: string;
    previousPage: string;
    nextPage: string;
  };
  classReconciliation: ClassTuitionReconciliationText;
  footnote: string;
};

export type FinanceDetailsText = Pick<FinanceReportText, 'details'>;
export type FinanceKpiText = Pick<FinanceReportText, 'kpi'> & {
  details: Pick<FinanceReportText['details'], 'viewDetails'>;
};
export type WaterfallText = Pick<FinanceReportText, 'waterfall'>;
export type TrendText = Pick<FinanceReportText, 'trend'>;
export type CategoryBreakdownText = Pick<
  FinanceReportText,
  'incomeByLevel' | 'expensesByCategory' | 'noData'
>;
export type ReceivablesText = Pick<
  FinanceReportText,
  'receivablesByStatus' | 'receivableCount' | 'statusLabels' | 'noData'
>;
export type StudentPaymentsText = Pick<FinanceReportText, 'students' | 'statusLabels'>;
