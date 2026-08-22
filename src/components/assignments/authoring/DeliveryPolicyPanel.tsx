import type { AssignmentDeliveryPolicy } from '../../../../shared/assignmentDelivery';

interface DeliveryPolicyPanelProps {
  policy: AssignmentDeliveryPolicy;
  classStudents: Array<{ id: string; name: string }>;
  onChange: (policy: AssignmentDeliveryPolicy) => void;
}

export function DeliveryPolicyPanel({ policy, classStudents, onChange }: DeliveryPolicyPanelProps) {
  const handleTargetModeChange = (targetMode: 'class' | 'selected_students') => {
    onChange({
      ...policy,
      targetMode,
      assignedStudentIds:
        targetMode === 'selected_students'
          ? policy.assignedStudentIds.length
            ? policy.assignedStudentIds
            : []
          : [],
    });
  };

  const handleStudentToggle = (studentId: string) => {
    const nextIds = policy.assignedStudentIds.includes(studentId)
      ? policy.assignedStudentIds.filter((id) => id !== studentId)
      : [...policy.assignedStudentIds, studentId];
    onChange({
      ...policy,
      assignedStudentIds: nextIds,
    });
  };

  const handleAvailableFromChange = (availableFrom: string) => {
    onChange({
      ...policy,
      availableFrom,
    });
  };

  const handleReleasePolicyChange = (
    resultReleasePolicy: 'after_submit' | 'after_due' | 'manual'
  ) => {
    onChange({
      ...policy,
      resultReleasePolicy,
    });
  };

  return (
    <div className="space-y-4 rounded-md border border-slate-200 p-4 bg-white">
      <h3 className="text-sm font-black uppercase text-slate-500">Delivery Rules</h3>

      <label className="block text-xs font-bold uppercase text-slate-500">
        Assignment target
        <select
          aria-label="Assignment target"
          value={policy.targetMode}
          onChange={(event) => handleTargetModeChange(event.target.value as any)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
        >
          <option value="class">All students in class</option>
          <option value="selected_students">Selected students</option>
        </select>
      </label>

      {policy.targetMode === 'selected_students' && (
        <div className="space-y-2">
          <span className="block text-xs font-bold uppercase text-slate-500">Target students</span>
          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-200 p-2 space-y-1 bg-slate-50">
            {classStudents.length > 0 ? (
              classStudents.map((student) => (
                <label
                  key={student.id}
                  className="flex items-center gap-2 text-sm text-slate-700 font-normal"
                >
                  <input
                    type="checkbox"
                    aria-label={`Assign ${student.name}`}
                    checked={policy.assignedStudentIds.includes(student.id)}
                    onChange={() => handleStudentToggle(student.id)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {student.name}
                </label>
              ))
            ) : (
              <p className="text-xs text-slate-500 italic p-1">No students in this class.</p>
            )}
          </div>
        </div>
      )}

      <label className="block text-xs font-bold uppercase text-slate-500">
        Available from
        <input
          type="text"
          aria-label="Available from"
          value={policy.availableFrom || ''}
          onChange={(event) => handleAvailableFromChange(event.target.value)}
          placeholder="2026-06-12T10:00:00.000Z"
          className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900 placeholder:text-slate-400"
        />
      </label>

      <label className="block text-xs font-bold uppercase text-slate-500">
        Result release
        <select
          aria-label="Result release"
          value={policy.resultReleasePolicy}
          onChange={(event) => handleReleasePolicyChange(event.target.value as any)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-900"
        >
          <option value="after_submit">Immediately after submit</option>
          <option value="after_due">After due date</option>
          <option value="manual">Manual release</option>
        </select>
      </label>
    </div>
  );
}
