import { useState } from 'react';
import type { VariableInventoryItem } from '../api.js';

export function variableEditPolicy(item: Pick<VariableInventoryItem, 'mutability' | 'requirement'>) {
  const editable = item.mutability === 'managed' && item.requirement !== 'unknown';
  return {
    editable,
    deletable: editable && item.requirement === 'optional',
    reason: item.mutability === 'observed' ? 'Observed definitions cannot be changed.' :
      item.requirement === 'unknown' ? 'Unknown definitions must be cataloged first.' : undefined
  };
}

export function VariableEditor({
  item,
  onStage,
  onDelete
}: {
  item: VariableInventoryItem;
  onStage: (value: string) => void;
  onDelete: () => void;
}) {
  const policy = variableEditPolicy(item);
  const [value, setValue] = useState(item.value);
  const [editing, setEditing] = useState(false);
  if (!policy.editable) return <span className="muted">Chỉ đọc: {policy.reason}</span>;
  return (
    <div className="variable-editor">
      {editing ? <>
        <label>
          Giá trị mới
          <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={2} />
        </label>
        <button type="button" onClick={() => onStage(value)}>Đưa vào bản nháp</button>
      </> : <button type="button" onClick={() => setEditing(true)}>Sửa</button>}
      {policy.deletable ? (
        <button type="button" onClick={onDelete}>Xóa tùy chọn</button>
      ) : null}
    </div>
  );
}
