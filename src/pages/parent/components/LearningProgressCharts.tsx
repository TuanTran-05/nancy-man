import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';
import { DONUT_COLORS } from '../utils';
import { ChartPanel, SectionCard } from './CommonWidgets';
import { useLanguage } from '../../../lib/i18n/useLanguage';

export function LearningProgressCharts({
  radarData,
  termTrendData,
  homeworkBarData,
  donutData,
  totalAssignments,
  mode = 'all',
}: {
  language?: 'vi' | 'en';
  radarData: Array<{ skill: string; current: number; previous: number | null }>;
  termTrendData: Array<{ name: string; score: number; isActual: boolean; tooltipLabel?: string }>;
  homeworkBarData: Array<{
    name: string;
    fullName: string;
    score: number | null;
    isGraded?: boolean;
    fill: string;
  }>;
  donutData: Array<{ name: string; value: number }>;
  totalAssignments: number;
  mode?: 'all' | 'progress' | 'homework';
}) {
  const { t } = useLanguage();

  return (
    <SectionCard
      icon={LineChartIcon}
      title={t.parent.learningProgressCharts}
      subtitle={t.parent.trendLinesDesc}
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {mode !== 'homework' && (
          <>
            <ChartPanel title={t.parent.semesterSkillRadar}>
              {radarData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} outerRadius="68%">
                    <PolarGrid stroke="#DBEAFE" />
                    <PolarAngleAxis dataKey="skill" tick={{ fill: '#475569', fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="current"
                      stroke="#3B82F6"
                      fill="#3B82F6"
                      fillOpacity={0.32}
                      strokeWidth={2.5}
                    />
                    <Radar
                      dataKey="previous"
                      stroke="#F97316"
                      fill="#F97316"
                      fillOpacity={0.08}
                      strokeWidth={2}
                      strokeDasharray="6 6"
                    />
                    <RechartsTooltip
                      formatter={(value: number | null, name: string) => [
                        typeof value === 'number' && Number.isFinite(value)
                          ? `${value.toFixed(0)}%`
                          : '--',
                        name,
                      ]}
                      contentStyle={{
                        borderRadius: 16,
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm text-slate-500">
                  Chưa có dữ liệu thành phần để hiển thị biểu đồ năng lực.
                </div>
              )}
            </ChartPanel>

            <ChartPanel title={t.parent.courseScoreTrend}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={termTrendData}
                  margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <RechartsTooltip
                    formatter={(value: number) => [`${value.toFixed(1)}/10`, t.parent.score]}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.tooltipLabel || label
                    }
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#2563EB"
                    strokeWidth={3}
                    dot={{ stroke: '#2563EB', strokeWidth: 2, r: 4, fill: '#fff' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          </>
        )}

        {mode !== 'progress' && (
          <>
            <ChartPanel title={t.parent.homeworkScores}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={homeworkBarData}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94A3B8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 10]}
                    tick={{ fill: '#94A3B8', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <RechartsTooltip
                    formatter={(value: number | null, _name: string, item: any) => {
                      const isGraded = item?.payload?.isGraded ?? Number.isFinite(value);
                      if (!isGraded || value === null) return ['Chưa chấm', t.parent.score];
                      return [`${Number(value).toFixed(1)}/10`, t.parent.score];
                    }}
                    labelFormatter={(label) => label}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
                    }}
                  />
                  <Bar dataKey="score" radius={[10, 10, 0, 0]} barSize={28}>
                    {homeworkBarData.map((item) => (
                      <Cell key={item.fullName} fill={item.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title={t.parent.homeworkStatus}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={88}
                    paddingAngle={4}
                  >
                    {donutData.map((slice, index) => (
                      <Cell key={slice.name} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (
                          !viewBox ||
                          typeof viewBox !== 'object' ||
                          !('cx' in viewBox) ||
                          !('cy' in viewBox)
                        ) {
                          return null;
                        }
                        const cx = (viewBox as any).cx;
                        const cy = (viewBox as any).cy;
                        return (
                          <g>
                            <text
                              x={cx}
                              y={cy - 2}
                              textAnchor="middle"
                              className="fill-slate-900 dark:fill-white text-2xl font-bold"
                            >
                              {totalAssignments}
                            </text>
                            <text
                              x={cx}
                              y={cy + 18}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-xs font-medium"
                            >
                              {t.parent.totalAssignments}
                            </text>
                          </g>
                        );
                      }}
                      position="center"
                    />
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [value, name]}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 20px 40px rgba(15,23,42,0.08)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-3 flex flex-wrap gap-3">
                {donutData.map((item, index) => (
                  <div
                    key={item.name}
                    className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }}
                    />
                    {item.name}: {item.value}
                  </div>
                ))}
              </div>
            </ChartPanel>
          </>
        )}
      </div>
    </SectionCard>
  );
}
