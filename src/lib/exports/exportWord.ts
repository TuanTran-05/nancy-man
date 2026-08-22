import { Class, Student, Evaluation } from '../../types';
import { formatVN } from '../core/utils';

export const exportClassReportWord = async (
  classData: Class,
  coursePeriod: { start: string; end: string },
  reportData: {
    student: Student;
    midtermEvaluation: Evaluation | null;
    finalEvaluation: Evaluation | null;
  }[]
) => {
  const [
    {
      Document,
      Packer,
      Paragraph,
      TextRun,
      Table,
      TableRow,
      TableCell,
      WidthType,
      BorderStyle,
      AlignmentType,
    },
    { saveAs },
  ] = await Promise.all([import('docx'), import('file-saver')]);

  const children: any[] = [];

  // Header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: 'BÁO CÁO KẾT QUẢ HỌC TẬP',
          bold: true,
          size: 32, // 16pt
        }),
      ],
      spacing: { after: 200 },
    })
  );

  const subtitleText =
    `Lớp: ${classData.name}` +
    (coursePeriod.start && coursePeriod.end
      ? `      Khóa: ${formatVN(coursePeriod.start, 'dd/MM/yyyy')} - ${formatVN(coursePeriod.end, 'dd/MM/yyyy')}`
      : '');

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: subtitleText,
          bold: true,
          size: 24, // 12pt
        }),
      ],
      spacing: { after: 400 },
    })
  );

  const renderEvaluationTable = (
    student: Student,
    ev: Evaluation | null,
    label: string,
    index: number
  ) => {
    const headerText = `${index + 1}. ${student.name.toUpperCase()} - ${label} ${ev?.finalScore !== undefined && ev?.finalScore !== null ? `(${ev.finalScore} điểm)` : ''}`;

    // Left column rows
    const categories = [
      { label: 'Attendance (Chuyên cần)', key: 'attendance' },
      { label: 'Effort & Participation (Đóng góp xây dựng bài)', key: 'effort' },
      { label: 'Pronunciation (Phát âm)', key: 'pronunciation' },
      { label: 'Homework (Bài tập về nhà)', key: 'homework' },
      { label: 'Behavior (Tác phong)', key: 'behavior' },
    ];

    const leftTableRows = categories.map((cat, i) => {
      return new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ text: cat.label })],
            width: { size: 65, type: WidthType.PERCENTAGE },
            borders: {
              bottom:
                i === categories.length - 1
                  ? { style: BorderStyle.NONE, size: 0, color: 'auto' }
                  : { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
            },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${ev?.scores?.[cat.key as keyof typeof ev.scores] || 0}%`,
                    bold: true,
                    size: 28,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
            width: { size: 35, type: WidthType.PERCENTAGE },
            borders: {
              bottom:
                i === categories.length - 1
                  ? { style: BorderStyle.NONE, size: 0, color: 'auto' }
                  : { style: BorderStyle.SINGLE, size: 1, color: '000000' },
            },
            verticalAlign: 'center',
          }),
        ],
      });
    });

    const leftTable = new Table({
      rows: leftTableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      },
    });

    // Right column content (Comments)
    const rightColumnChildren: any[] = [];
    if (ev) {
      (ev.positivePoints || []).forEach((p) => {
        rightColumnChildren.push(
          new Paragraph({
            text: p,
            bullet: { level: 0 },
            spacing: { after: 100 },
          })
        );
      });
      if (ev.improvementPoints) {
        rightColumnChildren.push(
          new Paragraph({
            children: [
              new TextRun({ text: 'Tuy nhiên: ', bold: true }),
              new TextRun({ text: ev.improvementPoints }),
            ],
            spacing: { before: 100 },
          })
        );
      }
    } else {
      rightColumnChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Chưa có đánh giá ${label.toLowerCase()} trong khoảng thời gian này.`,
              italics: true,
            }),
          ],
          alignment: AlignmentType.CENTER,
        })
      );
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
        right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: headerText, bold: true, size: 28 })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              columnSpan: 2,
              borders: {
                bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              },
              margins: { top: 150, bottom: 150 },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [leftTable],
              width: { size: 35, type: WidthType.PERCENTAGE },
              borders: {
                right: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              },
            }),
            new TableCell({
              children: rightColumnChildren,
              width: { size: 65, type: WidthType.PERCENTAGE },
              margins: { top: 150, bottom: 150, left: 150, right: 150 },
            }),
          ],
        }),
      ],
    });
  };

  // Students
  reportData.forEach((item, index) => {
    const { student, midtermEvaluation, finalEvaluation } = item;

    // Add Midterm
    children.push(renderEvaluationTable(student, midtermEvaluation, 'NHẬN XÉT GIỮA KHÓA', index));
    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Add Final
    children.push(renderEvaluationTable(student, finalEvaluation, 'NHẬN XÉT CUỐI KHÓA', index));
    children.push(new Paragraph({ spacing: { after: 600 } })); // Larger space between students
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  // File names use hyphens because slash-separated display dates are not valid path segments.
  saveAs(
    blob,
    `Evaluation_${classData?.name || 'Class'}_${formatVN(new Date(), 'dd-MM-yyyy')}.docx`
  );
};
