import { useState } from 'react';
import type { DatabaseCell } from '../../../../../packages/contracts/src/databaseExplorer.js';

export type CellDetailDialogProps = {
  open: boolean;
  columnName: string;
  cell: DatabaseCell | null;
  onClose: () => void;
};

export function CellDetailDialog({ open, columnName, cell, onClose }: CellDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  if (!open || !cell) return null;

  const isCopyable = cell.state === 'value' || cell.state === 'truncated';

  const getTextToCopy = (): string => {
    if (cell.state === 'value') {
      if (cell.value === null) return 'NULL';
      if (typeof cell.value === 'object') {
        return JSON.stringify(cell.value, null, 2);
      }
      return String(cell.value);
    }
    if (cell.state === 'truncated') {
      return cell.display;
    }
    return '';
  };

  const handleCopy = async () => {
    if (!isCopyable) return;
    try {
      await navigator.clipboard.writeText(getTextToCopy());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cell-detail-title"
    >
      <div className="modal-content cell-detail-modal">
        <header className="modal-header">
          <h2 id="cell-detail-title">Chi tiết ô {columnName}</h2>
          <button type="button" className="close-button" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </header>

        <div className="cell-detail-body">
          {cell.state === 'blocked' ? (
            <div className="cell-detail-blocked">
              <span className="badge-classification blocked">BLOCKED</span>
              <p>Giá trị bị chặn bởi chính sách bảo mật (Blocked / Never exposed).</p>
            </div>
          ) : cell.state === 'masked' ? (
            <div className="cell-detail-masked">
              <span className="badge-classification pii">PII (MASKED)</span>
              <div className="cell-masked-display">{cell.display}</div>
              <p className="cell-hint">Giá trị PII đang bị ẩn. Cần mở khóa để xem đầy đủ.</p>
            </div>
          ) : cell.state === 'truncated' ? (
            <div className="cell-detail-truncated">
              <span className="badge-classification internal">TRUNCATED</span>
              <p className="cell-hint">
                Dữ liệu dài đã bị cắt ngắn (Kích thước gốc: {cell.originalBytes} bytes)
              </p>
              <pre className="cell-code-block">{cell.display}</pre>
            </div>
          ) : cell.value === null ? (
            <div className="cell-detail-null">
              <em>NULL</em>
            </div>
          ) : typeof cell.value === 'object' ? (
            <pre className="cell-code-block">{JSON.stringify(cell.value, null, 2)}</pre>
          ) : (
            <div className="cell-scalar-text">{String(cell.value)}</div>
          )}
        </div>

        <footer className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleCopy}
            disabled={!isCopyable}
          >
            {copied ? 'Đã sao chép!' : isCopyable ? 'Sao chép giá trị' : 'Không thể sao chép'}
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            Đóng
          </button>
        </footer>
      </div>
    </div>
  );
}
