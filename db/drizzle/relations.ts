import { relations } from "drizzle-orm/relations";
import { students, studentAuthCredentials, users, staffEmailAccess, staffAccountRequests, passwordResetRequests, staffPasswordResetRequests, teacherRegistrationRequests, admissionsHistory, classes, studentProgressionEvents, systemSettings, classTerms, classTermWeeklySessions, classHolidays, classSessions, studentCourseEnrollments, studentLeavePeriods, attendance, evaluations, dailyReports, assignments, submissions, substituteRequests, assignmentQuestionOptions, assignmentQuestions, submissionQuizAnswers, submissionAssessmentAnswers, knowledgeBankItems, curriculums, courseFeeLedgers, examBank, examTemplates, ledgerNoticeLog, studentWallets, receipts, invoices, paymentRequests, receiptAllocations, walletTransactions, expenses, invoiceLineItems, tuitionConfigs, webhookEvents, paymentOrderCodes, courseClosings, refunds, courseClosingExemptions, courseClosingRecords, courseClosingRecordDocuments, teacherAvailabilityProfiles, teacherAvailabilityProfileSelections, teacherAvailabilitySlots, teacherAvailabilityChangeRequests, teacherAvailabilityChangeRequestSelections, notifications, adminNotifications, adminNotificationFailures, zaloNotifications, zaloBotLinks, zaloBotLinkCodes, zaloBotChatClaims, zaloBotChatSessions, zaloBotMessages, zaloBulkJobs, zaloBulkJobItems, jobs, printRequests, printRequestFiles } from "./schema";

export const studentAuthCredentialsRelations = relations(studentAuthCredentials, ({one}) => ({
	student: one(students, {
		fields: [studentAuthCredentials.studentId],
		references: [students.id]
	}),
}));

export const studentsRelations = relations(students, ({one, many}) => ({
	studentAuthCredentials: many(studentAuthCredentials),
	passwordResetRequests: many(passwordResetRequests),
	admissionsHistories: many(admissionsHistory),
	studentProgressionEvents: many(studentProgressionEvents),
	user_admittedBy: one(users, {
		fields: [students.admittedBy],
		references: [users.id],
		relationName: "students_admittedBy_users_id"
	}),
	class: one(classes, {
		fields: [students.trialClassId],
		references: [classes.id]
	}),
	user_trialTeacherId: one(users, {
		fields: [students.trialTeacherId],
		references: [users.id],
		relationName: "students_trialTeacherId_users_id"
	}),
	users: many(users, {
		relationName: "users_studentId_students_id"
	}),
	studentCourseEnrollments: many(studentCourseEnrollments),
	studentLeavePeriods: many(studentLeavePeriods),
	attendances: many(attendance),
	evaluations: many(evaluations),
	submissions: many(submissions),
	courseFeeLedgers: many(courseFeeLedgers),
	studentWallets: many(studentWallets),
	receipts: many(receipts),
	walletTransactions: many(walletTransactions),
	invoices: many(invoices),
	expenses: many(expenses),
	paymentRequests: many(paymentRequests),
	paymentOrderCodes: many(paymentOrderCodes),
	refunds: many(refunds),
	courseClosingExemptions: many(courseClosingExemptions),
	courseClosingRecords: many(courseClosingRecords),
	notifications: many(notifications),
	adminNotificationFailures: many(adminNotificationFailures),
	zaloNotifications: many(zaloNotifications),
	zaloBulkJobItems: many(zaloBulkJobItems),
}));

export const staffEmailAccessRelations = relations(staffEmailAccess, ({one}) => ({
	user: one(users, {
		fields: [staffEmailAccess.blockedBy],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	staffEmailAccesses: many(staffEmailAccess),
	staffAccountRequests: many(staffAccountRequests),
	passwordResetRequests: many(passwordResetRequests),
	staffPasswordResetRequests_resolvedBy: many(staffPasswordResetRequests, {
		relationName: "staffPasswordResetRequests_resolvedBy_users_id"
	}),
	staffPasswordResetRequests_userId: many(staffPasswordResetRequests, {
		relationName: "staffPasswordResetRequests_userId_users_id"
	}),
	teacherRegistrationRequests: many(teacherRegistrationRequests),
	admissionsHistories_actorId: many(admissionsHistory, {
		relationName: "admissionsHistory_actorId_users_id"
	}),
	admissionsHistories_teacherId: many(admissionsHistory, {
		relationName: "admissionsHistory_teacherId_users_id"
	}),
	studentProgressionEvents: many(studentProgressionEvents),
	systemSettings: many(systemSettings),
	classSessions: many(classSessions),
	classes_archivedBy: many(classes, {
		relationName: "classes_archivedBy_users_id"
	}),
	classes_teacherId: many(classes, {
		relationName: "classes_teacherId_users_id"
	}),
	students_admittedBy: many(students, {
		relationName: "students_admittedBy_users_id"
	}),
	students_trialTeacherId: many(students, {
		relationName: "students_trialTeacherId_users_id"
	}),
	student: one(students, {
		fields: [users.studentId],
		references: [students.id],
		relationName: "users_studentId_students_id"
	}),
	attendances_teacherId: many(attendance, {
		relationName: "attendance_teacherId_users_id"
	}),
	attendances_voidedBy: many(attendance, {
		relationName: "attendance_voidedBy_users_id"
	}),
	evaluations: many(evaluations),
	dailyReports: many(dailyReports),
	submissions: many(submissions),
	substituteRequests_requestingTeacherId: many(substituteRequests, {
		relationName: "substituteRequests_requestingTeacherId_users_id"
	}),
	substituteRequests_respondedBy: many(substituteRequests, {
		relationName: "substituteRequests_respondedBy_users_id"
	}),
	substituteRequests_substituteTeacherId: many(substituteRequests, {
		relationName: "substituteRequests_substituteTeacherId_users_id"
	}),
	assignments: many(assignments),
	knowledgeBankItems: many(knowledgeBankItems),
	curriculums: many(curriculums),
	examBanks: many(examBank),
	examTemplates: many(examTemplates),
	receipts_createdBy: many(receipts, {
		relationName: "receipts_createdBy_users_id"
	}),
	receipts_voidedBy: many(receipts, {
		relationName: "receipts_voidedBy_users_id"
	}),
	walletTransactions_approvedBy: many(walletTransactions, {
		relationName: "walletTransactions_approvedBy_users_id"
	}),
	walletTransactions_voidedBy: many(walletTransactions, {
		relationName: "walletTransactions_voidedBy_users_id"
	}),
	expenses: many(expenses),
	tuitionConfigs: many(tuitionConfigs),
	paymentRequests: many(paymentRequests),
	courseClosings_approvedBy: many(courseClosings, {
		relationName: "courseClosings_approvedBy_users_id"
	}),
	courseClosings_invalidatedBy: many(courseClosings, {
		relationName: "courseClosings_invalidatedBy_users_id"
	}),
	refunds_approvedBy: many(refunds, {
		relationName: "refunds_approvedBy_users_id"
	}),
	refunds_createdBy: many(refunds, {
		relationName: "refunds_createdBy_users_id"
	}),
	courseClosingExemptions: many(courseClosingExemptions),
	courseClosingRecords: many(courseClosingRecords),
	teacherAvailabilityProfiles_createdBy: many(teacherAvailabilityProfiles, {
		relationName: "teacherAvailabilityProfiles_createdBy_users_id"
	}),
	teacherAvailabilityProfiles_teacherId: many(teacherAvailabilityProfiles, {
		relationName: "teacherAvailabilityProfiles_teacherId_users_id"
	}),
	teacherAvailabilityProfiles_updatedBy: many(teacherAvailabilityProfiles, {
		relationName: "teacherAvailabilityProfiles_updatedBy_users_id"
	}),
	teacherAvailabilityChangeRequests_reviewedBy: many(teacherAvailabilityChangeRequests, {
		relationName: "teacherAvailabilityChangeRequests_reviewedBy_users_id"
	}),
	teacherAvailabilityChangeRequests_teacherId: many(teacherAvailabilityChangeRequests, {
		relationName: "teacherAvailabilityChangeRequests_teacherId_users_id"
	}),
	notifications: many(notifications),
	zaloNotifications_sentBy: many(zaloNotifications, {
		relationName: "zaloNotifications_sentBy_users_id"
	}),
	zaloNotifications_teacherId: many(zaloNotifications, {
		relationName: "zaloNotifications_teacherId_users_id"
	}),
	zaloBotLinks_linkedBy: many(zaloBotLinks, {
		relationName: "zaloBotLinks_linkedBy_users_id"
	}),
	zaloBotLinks_staffId: many(zaloBotLinks, {
		relationName: "zaloBotLinks_staffId_users_id"
	}),
	zaloBotLinkCodes: many(zaloBotLinkCodes),
	zaloBotChatClaims: many(zaloBotChatClaims),
	zaloBotChatSessions: many(zaloBotChatSessions),
	zaloBotMessages: many(zaloBotMessages),
	zaloBulkJobs: many(zaloBulkJobs),
	jobs: many(jobs),
	printRequests_handledBy: many(printRequests, {
		relationName: "printRequests_handledBy_users_id"
	}),
	printRequests_teacherId: many(printRequests, {
		relationName: "printRequests_teacherId_users_id"
	}),
}));

export const staffAccountRequestsRelations = relations(staffAccountRequests, ({one}) => ({
	user: one(users, {
		fields: [staffAccountRequests.reviewedBy],
		references: [users.id]
	}),
}));

export const passwordResetRequestsRelations = relations(passwordResetRequests, ({one}) => ({
	user: one(users, {
		fields: [passwordResetRequests.resolvedBy],
		references: [users.id]
	}),
	student: one(students, {
		fields: [passwordResetRequests.studentId],
		references: [students.id]
	}),
}));

export const staffPasswordResetRequestsRelations = relations(staffPasswordResetRequests, ({one}) => ({
	user_resolvedBy: one(users, {
		fields: [staffPasswordResetRequests.resolvedBy],
		references: [users.id],
		relationName: "staffPasswordResetRequests_resolvedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [staffPasswordResetRequests.userId],
		references: [users.id],
		relationName: "staffPasswordResetRequests_userId_users_id"
	}),
}));

export const teacherRegistrationRequestsRelations = relations(teacherRegistrationRequests, ({one}) => ({
	user: one(users, {
		fields: [teacherRegistrationRequests.reviewedBy],
		references: [users.id]
	}),
}));

export const admissionsHistoryRelations = relations(admissionsHistory, ({one}) => ({
	user_actorId: one(users, {
		fields: [admissionsHistory.actorId],
		references: [users.id],
		relationName: "admissionsHistory_actorId_users_id"
	}),
	class: one(classes, {
		fields: [admissionsHistory.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [admissionsHistory.studentId],
		references: [students.id]
	}),
	user_teacherId: one(users, {
		fields: [admissionsHistory.teacherId],
		references: [users.id],
		relationName: "admissionsHistory_teacherId_users_id"
	}),
}));

export const classesRelations = relations(classes, ({one, many}) => ({
	admissionsHistories: many(admissionsHistory),
	studentProgressionEvents_fromClassId: many(studentProgressionEvents, {
		relationName: "studentProgressionEvents_fromClassId_classes_id"
	}),
	studentProgressionEvents_toClassId: many(studentProgressionEvents, {
		relationName: "studentProgressionEvents_toClassId_classes_id"
	}),
	classSessions: many(classSessions),
	user_archivedBy: one(users, {
		fields: [classes.archivedBy],
		references: [users.id],
		relationName: "classes_archivedBy_users_id"
	}),
	class: one(classes, {
		fields: [classes.importSourceClassId],
		references: [classes.id],
		relationName: "classes_importSourceClassId_classes_id"
	}),
	classes: many(classes, {
		relationName: "classes_importSourceClassId_classes_id"
	}),
	user_teacherId: one(users, {
		fields: [classes.teacherId],
		references: [users.id],
		relationName: "classes_teacherId_users_id"
	}),
	classTerms: many(classTerms),
	students: many(students),
	studentCourseEnrollments: many(studentCourseEnrollments),
	studentLeavePeriods: many(studentLeavePeriods),
	attendances: many(attendance),
	evaluations: many(evaluations),
	dailyReports: many(dailyReports),
	submissions: many(submissions),
	substituteRequests: many(substituteRequests),
	assignments: many(assignments),
	knowledgeBankItems: many(knowledgeBankItems),
	courseFeeLedgers: many(courseFeeLedgers),
	receipts: many(receipts),
	receiptAllocations: many(receiptAllocations),
	walletTransactions: many(walletTransactions),
	invoices: many(invoices),
	expenses: many(expenses),
	tuitionConfigs: many(tuitionConfigs),
	paymentRequests: many(paymentRequests),
	paymentOrderCodes: many(paymentOrderCodes),
	refunds: many(refunds),
	courseClosingRecords: many(courseClosingRecords),
	notifications: many(notifications),
	zaloNotifications: many(zaloNotifications),
	zaloBotChatSessions: many(zaloBotChatSessions),
	zaloBulkJobs: many(zaloBulkJobs),
	zaloBulkJobItems: many(zaloBulkJobItems),
	printRequests: many(printRequests),
}));

export const studentProgressionEventsRelations = relations(studentProgressionEvents, ({one}) => ({
	user: one(users, {
		fields: [studentProgressionEvents.actorId],
		references: [users.id]
	}),
	student: one(students, {
		fields: [studentProgressionEvents.studentId],
		references: [students.id]
	}),
	class_fromClassId: one(classes, {
		fields: [studentProgressionEvents.fromClassId],
		references: [classes.id],
		relationName: "studentProgressionEvents_fromClassId_classes_id"
	}),
	class_toClassId: one(classes, {
		fields: [studentProgressionEvents.toClassId],
		references: [classes.id],
		relationName: "studentProgressionEvents_toClassId_classes_id"
	}),
}));

export const systemSettingsRelations = relations(systemSettings, ({one}) => ({
	user: one(users, {
		fields: [systemSettings.updatedBy],
		references: [users.id]
	}),
}));

export const classTermWeeklySessionsRelations = relations(classTermWeeklySessions, ({one}) => ({
	classTerm: one(classTerms, {
		fields: [classTermWeeklySessions.termId],
		references: [classTerms.id]
	}),
}));

export const classTermsRelations = relations(classTerms, ({one, many}) => ({
	classTermWeeklySessions: many(classTermWeeklySessions),
	classHolidays: many(classHolidays),
	classSessions: many(classSessions),
	class: one(classes, {
		fields: [classTerms.classId],
		references: [classes.id]
	}),
	studentCourseEnrollments: many(studentCourseEnrollments),
	evaluations: many(evaluations),
	courseFeeLedgers: many(courseFeeLedgers),
	courseClosings: many(courseClosings),
	courseClosingRecords: many(courseClosingRecords),
	zaloNotifications: many(zaloNotifications),
}));

export const classHolidaysRelations = relations(classHolidays, ({one}) => ({
	classTerm: one(classTerms, {
		fields: [classHolidays.termId],
		references: [classTerms.id]
	}),
}));

export const classSessionsRelations = relations(classSessions, ({one, many}) => ({
	class: one(classes, {
		fields: [classSessions.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [classSessions.teacherId],
		references: [users.id]
	}),
	classTerm: one(classTerms, {
		fields: [classSessions.termId],
		references: [classTerms.id]
	}),
	attendances: many(attendance),
	substituteRequests: many(substituteRequests),
}));

export const studentCourseEnrollmentsRelations = relations(studentCourseEnrollments, ({one, many}) => ({
	class: one(classes, {
		fields: [studentCourseEnrollments.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [studentCourseEnrollments.studentId],
		references: [students.id]
	}),
	classTerm: one(classTerms, {
		fields: [studentCourseEnrollments.termId],
		references: [classTerms.id]
	}),
	attendances: many(attendance),
	courseFeeLedgers: many(courseFeeLedgers),
}));

export const studentLeavePeriodsRelations = relations(studentLeavePeriods, ({one}) => ({
	class: one(classes, {
		fields: [studentLeavePeriods.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [studentLeavePeriods.studentId],
		references: [students.id]
	}),
}));

export const attendanceRelations = relations(attendance, ({one}) => ({
	class: one(classes, {
		fields: [attendance.classId],
		references: [classes.id]
	}),
	studentCourseEnrollment: one(studentCourseEnrollments, {
		fields: [attendance.enrollmentId],
		references: [studentCourseEnrollments.id]
	}),
	classSession: one(classSessions, {
		fields: [attendance.sessionId],
		references: [classSessions.id]
	}),
	student: one(students, {
		fields: [attendance.studentId],
		references: [students.id]
	}),
	user_teacherId: one(users, {
		fields: [attendance.teacherId],
		references: [users.id],
		relationName: "attendance_teacherId_users_id"
	}),
	user_voidedBy: one(users, {
		fields: [attendance.voidedBy],
		references: [users.id],
		relationName: "attendance_voidedBy_users_id"
	}),
}));

export const evaluationsRelations = relations(evaluations, ({one, many}) => ({
	class: one(classes, {
		fields: [evaluations.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [evaluations.studentId],
		references: [students.id]
	}),
	user: one(users, {
		fields: [evaluations.teacherId],
		references: [users.id]
	}),
	classTerm: one(classTerms, {
		fields: [evaluations.termId],
		references: [classTerms.id]
	}),
	zaloNotifications: many(zaloNotifications),
}));

export const dailyReportsRelations = relations(dailyReports, ({one}) => ({
	class: one(classes, {
		fields: [dailyReports.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [dailyReports.teacherId],
		references: [users.id]
	}),
}));

export const submissionsRelations = relations(submissions, ({one, many}) => ({
	assignment: one(assignments, {
		fields: [submissions.assignmentId],
		references: [assignments.id]
	}),
	class: one(classes, {
		fields: [submissions.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [submissions.studentId],
		references: [students.id]
	}),
	user: one(users, {
		fields: [submissions.teacherId],
		references: [users.id]
	}),
	submissionQuizAnswers: many(submissionQuizAnswers),
	submissionAssessmentAnswers: many(submissionAssessmentAnswers),
}));

export const assignmentsRelations = relations(assignments, ({one, many}) => ({
	submissions: many(submissions),
	class: one(classes, {
		fields: [assignments.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [assignments.teacherId],
		references: [users.id]
	}),
	assignmentQuestions: many(assignmentQuestions),
}));

export const substituteRequestsRelations = relations(substituteRequests, ({one}) => ({
	class: one(classes, {
		fields: [substituteRequests.classId],
		references: [classes.id]
	}),
	user_requestingTeacherId: one(users, {
		fields: [substituteRequests.requestingTeacherId],
		references: [users.id],
		relationName: "substituteRequests_requestingTeacherId_users_id"
	}),
	user_respondedBy: one(users, {
		fields: [substituteRequests.respondedBy],
		references: [users.id],
		relationName: "substituteRequests_respondedBy_users_id"
	}),
	classSession: one(classSessions, {
		fields: [substituteRequests.sessionId],
		references: [classSessions.id]
	}),
	user_substituteTeacherId: one(users, {
		fields: [substituteRequests.substituteTeacherId],
		references: [users.id],
		relationName: "substituteRequests_substituteTeacherId_users_id"
	}),
}));

export const assignmentQuestionsRelations = relations(assignmentQuestions, ({one, many}) => ({
	assignmentQuestionOption: one(assignmentQuestionOptions, {
		fields: [assignmentQuestions.id],
		references: [assignmentQuestionOptions.questionId],
		relationName: "assignmentQuestions_id_assignmentQuestionOptions_questionId"
	}),
	assignment: one(assignments, {
		fields: [assignmentQuestions.assignmentId],
		references: [assignments.id]
	}),
	assignmentQuestionOptions: many(assignmentQuestionOptions, {
		relationName: "assignmentQuestionOptions_questionId_assignmentQuestions_id"
	}),
	submissionQuizAnswers: many(submissionQuizAnswers),
}));

export const assignmentQuestionOptionsRelations = relations(assignmentQuestionOptions, ({one, many}) => ({
	assignmentQuestions: many(assignmentQuestions, {
		relationName: "assignmentQuestions_id_assignmentQuestionOptions_questionId"
	}),
	assignmentQuestion: one(assignmentQuestions, {
		fields: [assignmentQuestionOptions.questionId],
		references: [assignmentQuestions.id],
		relationName: "assignmentQuestionOptions_questionId_assignmentQuestions_id"
	}),
}));

export const submissionQuizAnswersRelations = relations(submissionQuizAnswers, ({one}) => ({
	assignmentQuestion: one(assignmentQuestions, {
		fields: [submissionQuizAnswers.questionId],
		references: [assignmentQuestions.id]
	}),
	submission: one(submissions, {
		fields: [submissionQuizAnswers.submissionId],
		references: [submissions.id]
	}),
}));

export const submissionAssessmentAnswersRelations = relations(submissionAssessmentAnswers, ({one}) => ({
	submission: one(submissions, {
		fields: [submissionAssessmentAnswers.submissionId],
		references: [submissions.id]
	}),
}));

export const knowledgeBankItemsRelations = relations(knowledgeBankItems, ({one}) => ({
	class: one(classes, {
		fields: [knowledgeBankItems.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [knowledgeBankItems.uploadedBy],
		references: [users.id]
	}),
}));

export const curriculumsRelations = relations(curriculums, ({one}) => ({
	user: one(users, {
		fields: [curriculums.createdBy],
		references: [users.id]
	}),
}));

export const courseFeeLedgersRelations = relations(courseFeeLedgers, ({one, many}) => ({
	class: one(classes, {
		fields: [courseFeeLedgers.classId],
		references: [classes.id]
	}),
	studentCourseEnrollment: one(studentCourseEnrollments, {
		fields: [courseFeeLedgers.enrollmentId],
		references: [studentCourseEnrollments.id]
	}),
	student: one(students, {
		fields: [courseFeeLedgers.studentId],
		references: [students.id]
	}),
	classTerm: one(classTerms, {
		fields: [courseFeeLedgers.termId],
		references: [classTerms.id]
	}),
	ledgerNoticeLogs: many(ledgerNoticeLog),
	receipts: many(receipts),
	receiptAllocations: many(receiptAllocations),
	walletTransactions: many(walletTransactions),
	invoices: many(invoices),
	invoiceLineItems: many(invoiceLineItems),
	paymentRequests: many(paymentRequests),
	paymentOrderCodes: many(paymentOrderCodes),
	refunds: many(refunds),
}));

export const examBankRelations = relations(examBank, ({one}) => ({
	user: one(users, {
		fields: [examBank.createdBy],
		references: [users.id]
	}),
}));

export const examTemplatesRelations = relations(examTemplates, ({one}) => ({
	user: one(users, {
		fields: [examTemplates.createdBy],
		references: [users.id]
	}),
}));

export const ledgerNoticeLogRelations = relations(ledgerNoticeLog, ({one}) => ({
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [ledgerNoticeLog.ledgerId],
		references: [courseFeeLedgers.id]
	}),
}));

export const studentWalletsRelations = relations(studentWallets, ({one}) => ({
	student: one(students, {
		fields: [studentWallets.studentId],
		references: [students.id]
	}),
}));

export const receiptsRelations = relations(receipts, ({one, many}) => ({
	class: one(classes, {
		fields: [receipts.classId],
		references: [classes.id]
	}),
	user_createdBy: one(users, {
		fields: [receipts.createdBy],
		references: [users.id],
		relationName: "receipts_createdBy_users_id"
	}),
	invoice: one(invoices, {
		fields: [receipts.invoiceId],
		references: [invoices.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [receipts.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	paymentRequest: one(paymentRequests, {
		fields: [receipts.paymentRequestId],
		references: [paymentRequests.id],
		relationName: "receipts_paymentRequestId_paymentRequests_id"
	}),
	student: one(students, {
		fields: [receipts.studentId],
		references: [students.id]
	}),
	user_voidedBy: one(users, {
		fields: [receipts.voidedBy],
		references: [users.id],
		relationName: "receipts_voidedBy_users_id"
	}),
	receiptAllocations: many(receiptAllocations),
	walletTransactions: many(walletTransactions),
	paymentRequests: many(paymentRequests, {
		relationName: "paymentRequests_receiptId_receipts_id"
	}),
	webhookEvents: many(webhookEvents),
}));

export const invoicesRelations = relations(invoices, ({one, many}) => ({
	receipts: many(receipts),
	class: one(classes, {
		fields: [invoices.classId],
		references: [classes.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [invoices.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	student: one(students, {
		fields: [invoices.studentId],
		references: [students.id]
	}),
	invoice: one(invoices, {
		fields: [invoices.supersededByInvoiceId],
		references: [invoices.id],
		relationName: "invoices_supersededByInvoiceId_invoices_id"
	}),
	invoices: many(invoices, {
		relationName: "invoices_supersededByInvoiceId_invoices_id"
	}),
	invoiceLineItems: many(invoiceLineItems),
	paymentRequests: many(paymentRequests),
}));

export const paymentRequestsRelations = relations(paymentRequests, ({one, many}) => ({
	receipts: many(receipts, {
		relationName: "receipts_paymentRequestId_paymentRequests_id"
	}),
	class: one(classes, {
		fields: [paymentRequests.classId],
		references: [classes.id]
	}),
	invoice: one(invoices, {
		fields: [paymentRequests.invoiceId],
		references: [invoices.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [paymentRequests.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	receipt: one(receipts, {
		fields: [paymentRequests.receiptId],
		references: [receipts.id],
		relationName: "paymentRequests_receiptId_receipts_id"
	}),
	student: one(students, {
		fields: [paymentRequests.studentId],
		references: [students.id]
	}),
	user: one(users, {
		fields: [paymentRequests.voidedBy],
		references: [users.id]
	}),
	webhookEvents: many(webhookEvents),
	paymentOrderCodes: many(paymentOrderCodes),
}));

export const receiptAllocationsRelations = relations(receiptAllocations, ({one}) => ({
	class: one(classes, {
		fields: [receiptAllocations.classId],
		references: [classes.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [receiptAllocations.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	receipt: one(receipts, {
		fields: [receiptAllocations.receiptId],
		references: [receipts.id]
	}),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({one, many}) => ({
	user_approvedBy: one(users, {
		fields: [walletTransactions.approvedBy],
		references: [users.id],
		relationName: "walletTransactions_approvedBy_users_id"
	}),
	class: one(classes, {
		fields: [walletTransactions.classId],
		references: [classes.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [walletTransactions.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	receipt: one(receipts, {
		fields: [walletTransactions.receiptId],
		references: [receipts.id]
	}),
	student: one(students, {
		fields: [walletTransactions.studentId],
		references: [students.id]
	}),
	user_voidedBy: one(users, {
		fields: [walletTransactions.voidedBy],
		references: [users.id],
		relationName: "walletTransactions_voidedBy_users_id"
	}),
	expense: one(expenses, {
		fields: [walletTransactions.expenseId],
		references: [expenses.id],
		relationName: "walletTransactions_expenseId_expenses_id"
	}),
	expenses: many(expenses, {
		relationName: "expenses_walletTransactionId_walletTransactions_id"
	}),
}));

export const expensesRelations = relations(expenses, ({one, many}) => ({
	walletTransactions: many(walletTransactions, {
		relationName: "walletTransactions_expenseId_expenses_id"
	}),
	class: one(classes, {
		fields: [expenses.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [expenses.createdBy],
		references: [users.id]
	}),
	student: one(students, {
		fields: [expenses.studentId],
		references: [students.id]
	}),
	walletTransaction: one(walletTransactions, {
		fields: [expenses.walletTransactionId],
		references: [walletTransactions.id],
		relationName: "expenses_walletTransactionId_walletTransactions_id"
	}),
	refunds: many(refunds),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoiceLineItems.invoiceId],
		references: [invoices.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [invoiceLineItems.ledgerId],
		references: [courseFeeLedgers.id]
	}),
}));

export const tuitionConfigsRelations = relations(tuitionConfigs, ({one}) => ({
	class: one(classes, {
		fields: [tuitionConfigs.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [tuitionConfigs.teacherId],
		references: [users.id]
	}),
}));

export const webhookEventsRelations = relations(webhookEvents, ({one}) => ({
	paymentRequest: one(paymentRequests, {
		fields: [webhookEvents.paymentRequestId],
		references: [paymentRequests.id]
	}),
	receipt: one(receipts, {
		fields: [webhookEvents.receiptId],
		references: [receipts.id]
	}),
}));

export const paymentOrderCodesRelations = relations(paymentOrderCodes, ({one}) => ({
	class: one(classes, {
		fields: [paymentOrderCodes.classId],
		references: [classes.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [paymentOrderCodes.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	paymentRequest: one(paymentRequests, {
		fields: [paymentOrderCodes.paymentRequestId],
		references: [paymentRequests.id]
	}),
	student: one(students, {
		fields: [paymentOrderCodes.studentId],
		references: [students.id]
	}),
}));

export const courseClosingsRelations = relations(courseClosings, ({one, many}) => ({
	user_approvedBy: one(users, {
		fields: [courseClosings.approvedBy],
		references: [users.id],
		relationName: "courseClosings_approvedBy_users_id"
	}),
	user_invalidatedBy: one(users, {
		fields: [courseClosings.invalidatedBy],
		references: [users.id],
		relationName: "courseClosings_invalidatedBy_users_id"
	}),
	classTerm: one(classTerms, {
		fields: [courseClosings.termId],
		references: [classTerms.id]
	}),
	courseClosingExemptions: many(courseClosingExemptions),
}));

export const refundsRelations = relations(refunds, ({one}) => ({
	user_approvedBy: one(users, {
		fields: [refunds.approvedBy],
		references: [users.id],
		relationName: "refunds_approvedBy_users_id"
	}),
	class: one(classes, {
		fields: [refunds.classId],
		references: [classes.id]
	}),
	user_createdBy: one(users, {
		fields: [refunds.createdBy],
		references: [users.id],
		relationName: "refunds_createdBy_users_id"
	}),
	expense: one(expenses, {
		fields: [refunds.expenseId],
		references: [expenses.id]
	}),
	courseFeeLedger: one(courseFeeLedgers, {
		fields: [refunds.ledgerId],
		references: [courseFeeLedgers.id]
	}),
	student: one(students, {
		fields: [refunds.studentId],
		references: [students.id]
	}),
}));

export const courseClosingExemptionsRelations = relations(courseClosingExemptions, ({one}) => ({
	courseClosing: one(courseClosings, {
		fields: [courseClosingExemptions.closingId],
		references: [courseClosings.id]
	}),
	user: one(users, {
		fields: [courseClosingExemptions.grantedBy],
		references: [users.id]
	}),
	student: one(students, {
		fields: [courseClosingExemptions.studentId],
		references: [students.id]
	}),
}));

export const courseClosingRecordsRelations = relations(courseClosingRecords, ({one, many}) => ({
	class: one(classes, {
		fields: [courseClosingRecords.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [courseClosingRecords.studentId],
		references: [students.id]
	}),
	user: one(users, {
		fields: [courseClosingRecords.teacherId],
		references: [users.id]
	}),
	classTerm: one(classTerms, {
		fields: [courseClosingRecords.termId],
		references: [classTerms.id]
	}),
	courseClosingRecordDocuments: many(courseClosingRecordDocuments),
}));

export const courseClosingRecordDocumentsRelations = relations(courseClosingRecordDocuments, ({one}) => ({
	courseClosingRecord: one(courseClosingRecords, {
		fields: [courseClosingRecordDocuments.recordId],
		references: [courseClosingRecords.id]
	}),
}));

export const teacherAvailabilityProfilesRelations = relations(teacherAvailabilityProfiles, ({one, many}) => ({
	user_createdBy: one(users, {
		fields: [teacherAvailabilityProfiles.createdBy],
		references: [users.id],
		relationName: "teacherAvailabilityProfiles_createdBy_users_id"
	}),
	user_teacherId: one(users, {
		fields: [teacherAvailabilityProfiles.teacherId],
		references: [users.id],
		relationName: "teacherAvailabilityProfiles_teacherId_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [teacherAvailabilityProfiles.updatedBy],
		references: [users.id],
		relationName: "teacherAvailabilityProfiles_updatedBy_users_id"
	}),
	teacherAvailabilityProfileSelections: many(teacherAvailabilityProfileSelections),
	teacherAvailabilityChangeRequests: many(teacherAvailabilityChangeRequests),
}));

export const teacherAvailabilityProfileSelectionsRelations = relations(teacherAvailabilityProfileSelections, ({one}) => ({
	teacherAvailabilityProfile: one(teacherAvailabilityProfiles, {
		fields: [teacherAvailabilityProfileSelections.profileId],
		references: [teacherAvailabilityProfiles.id]
	}),
	teacherAvailabilitySlot: one(teacherAvailabilitySlots, {
		fields: [teacherAvailabilityProfileSelections.slotId],
		references: [teacherAvailabilitySlots.slotId]
	}),
}));

export const teacherAvailabilitySlotsRelations = relations(teacherAvailabilitySlots, ({many}) => ({
	teacherAvailabilityProfileSelections: many(teacherAvailabilityProfileSelections),
	teacherAvailabilityChangeRequestSelections: many(teacherAvailabilityChangeRequestSelections),
}));

export const teacherAvailabilityChangeRequestsRelations = relations(teacherAvailabilityChangeRequests, ({one, many}) => ({
	teacherAvailabilityProfile: one(teacherAvailabilityProfiles, {
		fields: [teacherAvailabilityChangeRequests.profileId],
		references: [teacherAvailabilityProfiles.id]
	}),
	user_reviewedBy: one(users, {
		fields: [teacherAvailabilityChangeRequests.reviewedBy],
		references: [users.id],
		relationName: "teacherAvailabilityChangeRequests_reviewedBy_users_id"
	}),
	user_teacherId: one(users, {
		fields: [teacherAvailabilityChangeRequests.teacherId],
		references: [users.id],
		relationName: "teacherAvailabilityChangeRequests_teacherId_users_id"
	}),
	teacherAvailabilityChangeRequestSelections: many(teacherAvailabilityChangeRequestSelections),
}));

export const teacherAvailabilityChangeRequestSelectionsRelations = relations(teacherAvailabilityChangeRequestSelections, ({one}) => ({
	teacherAvailabilityChangeRequest: one(teacherAvailabilityChangeRequests, {
		fields: [teacherAvailabilityChangeRequestSelections.requestId],
		references: [teacherAvailabilityChangeRequests.id]
	}),
	teacherAvailabilitySlot: one(teacherAvailabilitySlots, {
		fields: [teacherAvailabilityChangeRequestSelections.slotId],
		references: [teacherAvailabilitySlots.slotId]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	class: one(classes, {
		fields: [notifications.classId],
		references: [classes.id]
	}),
	student: one(students, {
		fields: [notifications.studentId],
		references: [students.id]
	}),
	user: one(users, {
		fields: [notifications.teacherId],
		references: [users.id]
	}),
}));

export const adminNotificationFailuresRelations = relations(adminNotificationFailures, ({one}) => ({
	adminNotification: one(adminNotifications, {
		fields: [adminNotificationFailures.adminNotificationId],
		references: [adminNotifications.id]
	}),
	student: one(students, {
		fields: [adminNotificationFailures.studentId],
		references: [students.id]
	}),
	zaloNotification: one(zaloNotifications, {
		fields: [adminNotificationFailures.zaloNotificationId],
		references: [zaloNotifications.id]
	}),
}));

export const adminNotificationsRelations = relations(adminNotifications, ({many}) => ({
	adminNotificationFailures: many(adminNotificationFailures),
}));

export const zaloNotificationsRelations = relations(zaloNotifications, ({one, many}) => ({
	adminNotificationFailures: many(adminNotificationFailures),
	class: one(classes, {
		fields: [zaloNotifications.classId],
		references: [classes.id]
	}),
	evaluation: one(evaluations, {
		fields: [zaloNotifications.evaluationId],
		references: [evaluations.id]
	}),
	user_sentBy: one(users, {
		fields: [zaloNotifications.sentBy],
		references: [users.id],
		relationName: "zaloNotifications_sentBy_users_id"
	}),
	student: one(students, {
		fields: [zaloNotifications.studentId],
		references: [students.id]
	}),
	user_teacherId: one(users, {
		fields: [zaloNotifications.teacherId],
		references: [users.id],
		relationName: "zaloNotifications_teacherId_users_id"
	}),
	classTerm: one(classTerms, {
		fields: [zaloNotifications.termId],
		references: [classTerms.id]
	}),
	zaloBulkJobItems: many(zaloBulkJobItems),
}));

export const zaloBotLinksRelations = relations(zaloBotLinks, ({one}) => ({
	user_linkedBy: one(users, {
		fields: [zaloBotLinks.linkedBy],
		references: [users.id],
		relationName: "zaloBotLinks_linkedBy_users_id"
	}),
	user_staffId: one(users, {
		fields: [zaloBotLinks.staffId],
		references: [users.id],
		relationName: "zaloBotLinks_staffId_users_id"
	}),
}));

export const zaloBotLinkCodesRelations = relations(zaloBotLinkCodes, ({one}) => ({
	user: one(users, {
		fields: [zaloBotLinkCodes.staffId],
		references: [users.id]
	}),
}));

export const zaloBotChatClaimsRelations = relations(zaloBotChatClaims, ({one}) => ({
	user: one(users, {
		fields: [zaloBotChatClaims.staffId],
		references: [users.id]
	}),
}));

export const zaloBotChatSessionsRelations = relations(zaloBotChatSessions, ({one}) => ({
	class: one(classes, {
		fields: [zaloBotChatSessions.lastClassId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [zaloBotChatSessions.staffId],
		references: [users.id]
	}),
}));

export const zaloBotMessagesRelations = relations(zaloBotMessages, ({one}) => ({
	user: one(users, {
		fields: [zaloBotMessages.staffId],
		references: [users.id]
	}),
}));

export const zaloBulkJobsRelations = relations(zaloBulkJobs, ({one, many}) => ({
	class: one(classes, {
		fields: [zaloBulkJobs.classId],
		references: [classes.id]
	}),
	user: one(users, {
		fields: [zaloBulkJobs.createdBy],
		references: [users.id]
	}),
	zaloBulkJobItems: many(zaloBulkJobItems),
}));

export const zaloBulkJobItemsRelations = relations(zaloBulkJobItems, ({one}) => ({
	class: one(classes, {
		fields: [zaloBulkJobItems.classId],
		references: [classes.id]
	}),
	zaloBulkJob: one(zaloBulkJobs, {
		fields: [zaloBulkJobItems.jobId],
		references: [zaloBulkJobs.id]
	}),
	zaloNotification: one(zaloNotifications, {
		fields: [zaloBulkJobItems.messageId],
		references: [zaloNotifications.id]
	}),
	student: one(students, {
		fields: [zaloBulkJobItems.studentId],
		references: [students.id]
	}),
}));

export const jobsRelations = relations(jobs, ({one}) => ({
	user: one(users, {
		fields: [jobs.requestedById],
		references: [users.id]
	}),
}));

export const printRequestsRelations = relations(printRequests, ({one, many}) => ({
	class: one(classes, {
		fields: [printRequests.classId],
		references: [classes.id]
	}),
	user_handledBy: one(users, {
		fields: [printRequests.handledBy],
		references: [users.id],
		relationName: "printRequests_handledBy_users_id"
	}),
	user_teacherId: one(users, {
		fields: [printRequests.teacherId],
		references: [users.id],
		relationName: "printRequests_teacherId_users_id"
	}),
	printRequestFiles: many(printRequestFiles),
}));

export const printRequestFilesRelations = relations(printRequestFiles, ({one}) => ({
	printRequest: one(printRequests, {
		fields: [printRequestFiles.printRequestId],
		references: [printRequests.id]
	}),
}));