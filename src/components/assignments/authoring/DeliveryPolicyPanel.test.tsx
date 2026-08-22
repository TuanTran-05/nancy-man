// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryPolicyPanel } from './DeliveryPolicyPanel';
import type { AssignmentDeliveryPolicy } from '../../../../shared/assignmentDelivery';

function StatefulDeliveryPolicyPanel({
  classStudents,
  initialPolicy,
  onChange,
}: {
  classStudents: Array<{ id: string; name: string }>;
  initialPolicy: AssignmentDeliveryPolicy;
  onChange: (policy: AssignmentDeliveryPolicy) => void;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  return (
    <DeliveryPolicyPanel
      classStudents={classStudents}
      policy={policy}
      onChange={(p) => {
        setPolicy(p);
        onChange(p);
      }}
    />
  );
}

describe('DeliveryPolicyPanel', () => {
  it('edits selected-student targeting and release policy', () => {
    const onChange = vi.fn();
    render(
      <StatefulDeliveryPolicyPanel
        classStudents={[
          { id: 'student-1', name: 'Student One' },
          { id: 'student-2', name: 'Student Two' },
        ]}
        initialPolicy={{
          targetMode: 'class',
          assignedStudentIds: [],
          availableFrom: '',
          resultReleasePolicy: 'after_submit',
        }}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Assignment target'), {
      target: { value: 'selected_students' },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetMode: 'selected_students' })
    );

    fireEvent.click(screen.getByLabelText('Assign Student One'));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignedStudentIds: ['student-1'] })
    );

    fireEvent.change(screen.getByLabelText('Result release'), { target: { value: 'after_due' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ resultReleasePolicy: 'after_due' })
    );
  });
});
