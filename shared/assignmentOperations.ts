export interface AssignmentProgressStudent {
  id: string;
  name: string;
}

export interface AssignmentProgressSubmission {
  id: string;
  studentId: string;
  studentName?: string;
  status?: string;
  submittedAt: string;
  grade?: number | null;
  assessmentScore?: { canAutoGradeAll?: boolean } | null;
}

export interface AssignmentProgressSummaryInput {
  now: Date;
  dueDate: string;
  targetStudents: AssignmentProgressStudent[];
  submissions: AssignmentProgressSubmission[];
}

export function buildAssignmentProgressSummary(input: AssignmentProgressSummaryInput) {
  const targetStudentIds = new Set(input.targetStudents.map((student) => student.id));
  const targetSubmissions = input.submissions.filter((submission) =>
    targetStudentIds.has(submission.studentId)
  );
  const latestByStudent = new Map<string, AssignmentProgressSubmission>();
  for (const submission of targetSubmissions) {
    const current = latestByStudent.get(submission.studentId);
    if (!current || Date.parse(submission.submittedAt) > Date.parse(current.submittedAt)) {
      latestByStudent.set(submission.studentId, submission);
    }
  }

  const dueMs = Date.parse(input.dueDate);
  const missingStudents = input.targetStudents.filter(
    (student) => !latestByStudent.has(student.id)
  );
  const latestSubmissions = Array.from(latestByStudent.values());
  const manualGradingQueue = latestSubmissions.filter(
    (submission) =>
      submission.status === 'submitted' || submission.assessmentScore?.canAutoGradeAll === false
  );
  const late = latestSubmissions.filter(
    (submission) => Number.isFinite(dueMs) && Date.parse(submission.submittedAt) > dueMs
  );

  return {
    counts: {
      target: input.targetStudents.length,
      submitted: latestSubmissions.length,
      graded: latestSubmissions.filter(
        (submission) => submission.status === 'graded' || submission.grade !== null
      ).length,
      missing: missingStudents.length,
      late: late.length,
      pendingManual: manualGradingQueue.length,
    },
    missingStudents,
    manualGradingQueue,
    lateSubmissions: late,
  };
}
