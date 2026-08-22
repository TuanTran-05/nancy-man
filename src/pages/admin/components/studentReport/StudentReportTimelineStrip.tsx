import React from 'react';
import type { StudentTimelineSegment } from '../../../../lib/api/studentAdminReportApi';
import { formatClassOption, formatTermOption } from './StudentReportFilters';

type Props = {
  segments: StudentTimelineSegment[];
  activeKey: string | null;
  onSelect: (segment: StudentTimelineSegment) => void;
  t: any;
};

type ClassGroup = {
  classId: string;
  className: string;
  classMissing: boolean;
  segments: StudentTimelineSegment[];
};

function groupByClass(segments: StudentTimelineSegment[]): ClassGroup[] {
  const groups: ClassGroup[] = [];
  for (const segment of segments) {
    let group = groups.find((g) => g.classId === segment.classId);
    if (!group) {
      group = {
        classId: segment.classId,
        className: segment.className,
        classMissing: segment.classMissing,
        segments: [],
      };
      groups.push(group);
    }
    group.segments.push(segment);
  }
  return groups;
}

export const StudentReportTimelineStrip: React.FC<Props> = ({
  segments,
  activeKey,
  onSelect,
  t,
}) => {
  if (segments.length === 0) return null;

  const groups = groupByClass(segments);

  return (
    <div className="mb-6" id="report-timeline-strip" data-testid="report-timeline-strip">
      <p className="text-xs text-muted font-medium mb-2">{t.timeline.title}</p>
      <div className="flex flex-wrap items-stretch gap-4 overflow-x-auto pb-1">
        {groups.map((group) => (
          <div
            key={group.classId}
            className="flex flex-col gap-1.5"
            data-testid={`timeline-group-${group.classId}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-heading">
                {formatClassOption(group, t)}
              </span>
              <span className="text-xs text-muted">
                {t.timeline.courseCount.replace('{count}', String(group.segments.length))}
              </span>
            </div>
            <div className="flex gap-1.5">
              {group.segments.map((segment) => {
                const isActive = segment.key === activeKey;
                return (
                  <button
                    key={segment.key}
                    data-testid={`timeline-segment-${segment.key}`}
                    title={formatTermOption(segment, t)}
                    onClick={() => onSelect(segment)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-border-light text-muted hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {segment.term.termId === 'unknown'
                      ? t.filters.termUnknown
                      : `${t.filters.termLabel} ${segment.term.index}`}
                    {segment.term.isCurrent && <span className="ml-1">•</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
