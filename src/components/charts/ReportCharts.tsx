import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/core/utils';

export const PieChartVisual = ({
  data,
  colors,
  tm,
}: {
  data: { label: string; value: number; color?: string }[];
  colors?: string[];
  tm: any;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0)
    return (
      <div className="flex items-center justify-center p-8 text-subtle">
        {tm?.noData || 'No data'}
      </div>
    );

  let currentOffset = 0;

  return (
    <div className="relative w-full aspect-square max-w-[200px] mx-auto">
      <motion.svg
        viewBox="0 0 100 100"
        className="w-full h-full drop-shadow-sm"
        initial={{ opacity: 0, scale: 0.82, rotate: -180 }}
        animate={{ opacity: 1, scale: 1, rotate: -90 }}
        transition={{ type: 'spring', stiffness: 90, damping: 15 }}
      >
        {data
          .filter((d) => d.value > 0)
          .map((item, index) => {
            const circumference = 2 * Math.PI * 25; // r=25
            const strokeLength = (item.value / total) * circumference;
            const strokeDasharray = `${strokeLength} 1000`;
            const strokeDashoffset = -currentOffset;
            currentOffset += strokeLength;

            return (
              <motion.circle
                key={index}
                cx="50"
                cy="50"
                r="25"
                fill="transparent"
                stroke={item.color || (colors ? colors[index % colors.length] : '#3b82f6')}
                strokeWidth="50"
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ transformOrigin: '50px 50px' }}
                transition={{ type: 'spring', stiffness: 80, damping: 14, delay: index * 0.05 }}
              />
            );
          })}
      </motion.svg>
    </div>
  );
};

export const DonutChart = ({
  data,
  colors,
  tm,
}: {
  data: { label: string; value: number }[];
  colors: string[];
  tm: any;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total === 0)
    return (
      <div className="flex items-center justify-center p-8 text-subtle">
        {tm?.noData || 'No data'}
      </div>
    );

  let currentOffset = 0;

  return (
    <div className="relative w-full aspect-square max-w-[200px] mx-auto">
      <motion.svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        initial={{ opacity: 0, scale: 0.82, rotate: -180 }}
        animate={{ opacity: 1, scale: 1, rotate: -90 }}
        transition={{ type: 'spring', stiffness: 90, damping: 15 }}
      >
        {data.map((item, index) => {
          const circumference = 2 * Math.PI * 40;
          const strokeLength = (item.value / total) * circumference;

          const strokeDasharray = `${strokeLength} 1000`;
          const strokeDashoffset = -currentOffset;

          currentOffset += strokeLength;

          return (
            <motion.circle
              key={index}
              cx="50"
              cy="50"
              r="40"
              fill="transparent"
              stroke={colors[index % colors.length]}
              strokeWidth="12"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ transformOrigin: '50px 50px' }}
              transition={{ type: 'spring', stiffness: 80, damping: 14, delay: index * 0.05 }}
            />
          );
        })}
      </motion.svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-body">{total}</span>
        <span className="text-xs text-muted uppercase font-medium tracking-wider">
          {tm?.total || 'Total'}
        </span>
      </div>
    </div>
  );
};

export const BarChart = ({
  data,
  tm,
}: {
  data: { label: string; value: number; color?: string }[];
  tm: any;
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  if (data.length === 0)
    return <div className="p-8 text-center text-subtle">{tm?.noData || 'No data'}</div>;

  return (
    <div className="mt-4 w-full overflow-x-auto overflow-y-hidden pb-2">
      <div
        className="flex h-[200px] items-end justify-center gap-2 px-2"
        style={{ minWidth: `${Math.max(data.length * 44, 240)}px` }}
      >
        {data.map((item, index) => (
          <div key={index} className="group flex h-full w-9 shrink-0 flex-col items-center">
            <div className="mb-2 text-xs font-medium text-slate-600 opacity-0 transition-opacity group-hover:opacity-100">
              {item.value}
            </div>
            <div className="relative flex w-full flex-1 items-end rounded-t-sm border border-border-default/50 bg-slate-100">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(item.value / maxValue) * 100}%` }}
                transition={{ duration: 1, type: 'spring' }}
                className="w-full rounded-t-sm"
                style={{ backgroundColor: item.color || '#4f46e5' }}
              />
            </div>
            <span
              className="mt-2 w-full truncate text-center text-[10px] text-muted sm:text-xs"
              title={item.label}
            >
              {item.label.length > 8 ? item.label.substring(0, 6) + '..' : item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const HorizontalBarChart = ({
  data,
  onItemClick,
  tm,
}: {
  data: { label: string; value: number; color?: string; id?: string }[];
  onItemClick?: (item: any) => void;
  tm: any;
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (data.length === 0)
    return <div className="p-8 text-center text-subtle">{tm?.noData || 'No data'}</div>;

  return (
    <div className="w-full flex flex-col justify-center gap-1 h-full min-h-[220px]">
      {data.map((item, index) => (
        <div
          key={index}
          className={cn('flex flex-col w-full mb-3 group', onItemClick && 'cursor-pointer')}
          onClick={() => onItemClick && onItemClick(item)}
        >
          <div className="flex justify-between text-[11px] sm:text-xs font-bold text-slate-600 mb-1.5">
            <span className="truncate pr-2 uppercase tracking-wider" title={item.label}>
              {item.label}
            </span>
            <div className="flex items-center space-x-2">
              <span className="text-slate-900">{item.value}</span>
              <span className="text-subtle font-normal">
                ({total > 0 ? Math.round((item.value / total) * 100) : 0}%)
              </span>
            </div>
          </div>
          <div className="w-full relative bg-page rounded-full h-[10px] flex items-center border border-border-light group-hover:border-border-default transition-colors">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(item.value / maxValue) * 100}%` }}
              transition={{ duration: 1, type: 'spring', bounce: 0.2 }}
              className="h-full rounded-full shadow-sm"
              style={{ backgroundColor: item.color || '#4f46e5' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export const LineChart = ({ data, tm }: { data: { label: string; value: number }[]; tm: any }) => {
  const maxValue = Math.max(...data.map((d) => d.value), 100);

  if (data.length === 0)
    return <div className="p-8 text-center text-subtle">{tm?.noData || 'No data'}</div>;

  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1 || 1)) * 100;
      const y = 100 - (d.value / maxValue) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="relative w-full h-[200px] mt-4 px-4 pb-6 pt-4">
      <div className="absolute inset-0 flex flex-col justify-between pt-4 pb-6 border-l border-border-default">
        {[100, 75, 50, 25, 0].map((v) => (
          <div key={v} className="w-full flex items-center h-0 position-relative">
            <span className="absolute -left-6 text-[10px] text-subtle">{v}%</span>
            <div className="w-full h-[1px] bg-slate-100" />
          </div>
        ))}
      </div>

      <svg className="w-full h-full overflow-visible" preserveAspectRatio="none">
        <motion.polyline
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.5, ease: 'easeInOut' }}
          points={points}
          fill="none"
          stroke="#4f46e5"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) => {
          const x = (i / (data.length - 1 || 1)) * 100;
          const y = 100 - (d.value / maxValue) * 100;
          return (
            <motion.circle
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              key={i}
              cx={`${x}%`}
              cy={`${y}%`}
              r="4"
              fill="#ffffff"
              stroke="#4f46e5"
              strokeWidth="2"
            />
          );
        })}
      </svg>

      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-4 mt-2">
        {data.map((d, i) => (
          <span key={i} className="text-[10px] text-muted">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export const RadarChart = ({ data }: { data: { label: string; value: number }[] }) => {
  if (data.length === 0) return null;

  const size = 200;
  const center = size / 2;
  const radius = size * 0.4;

  const points = data.map((d, i) => {
    const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2;
    const value = d.value || 0;
    const r = (value / 100) * radius;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return {
      x,
      y,
      labelX: center + (radius + 20) * Math.cos(angle),
      labelY: center + (radius + 20) * Math.sin(angle),
    };
  });

  const polygonPoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const bgPolygons = [100, 80, 60, 40, 20].map((level) => {
    return data
      .map((_, i) => {
        const angle = (Math.PI * 2 * i) / data.length - Math.PI / 2;
        const r = (level / 100) * radius;
        return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
      })
      .join(' ');
  });

  return (
    <div className="relative w-full max-w-[280px] mx-auto pb-4">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full overflow-visible">
        {bgPolygons.map((poly, i) => (
          <polygon key={i} points={poly} fill="none" stroke="#e2e8f0" strokeWidth="1" />
        ))}
        <text
          x={center}
          y={center - radius}
          fontSize="8"
          fill="#94a3b8"
          dominantBaseline="middle"
          textAnchor="end"
          dx="-4"
          dy="-4"
        >
          100
        </text>
        <text
          x={center}
          y={center - radius * 0.5}
          fontSize="8"
          fill="#94a3b8"
          dominantBaseline="middle"
          textAnchor="end"
          dx="-4"
          dy="-4"
        >
          50
        </text>
        {points.map((p, i) => (
          <line
            key={`axis-${i}`}
            x1={center}
            y1={center}
            x2={center + radius * Math.cos((Math.PI * 2 * i) / data.length - Math.PI / 2)}
            y2={center + radius * Math.sin((Math.PI * 2 * i) / data.length - Math.PI / 2)}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}
        <motion.polygon
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 0.2, scale: 1 }}
          style={{ transformOrigin: `${center}px ${center}px` }}
          points={polygonPoints}
          fill="#8b5cf6"
        />
        <motion.polygon
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ transformOrigin: `${center}px ${center}px` }}
          points={polygonPoints}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <motion.circle
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            key={`pt-${i}`}
            cx={p.x}
            cy={p.y}
            r="3"
            fill="#8b5cf6"
          />
        ))}
        {points.map((p, i) => (
          <text
            key={`text-${i}`}
            x={p.labelX}
            y={p.labelY}
            fontSize="10"
            fontWeight="600"
            fill="#64748b"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {data[i].label}
          </text>
        ))}
      </svg>
    </div>
  );
};
