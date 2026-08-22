import ExcelJS from 'exceljs';

const outputPath = new URL('../public/student-import-template.xlsx', import.meta.url);

const workbook = new ExcelJS.Workbook();
workbook.creator = 'EduTrack';
workbook.created = new Date();

const worksheet = workbook.addWorksheet('Students', {
  views: [{ state: 'frozen', ySplit: 1 }],
});

worksheet.columns = [
  { header: 'Tên học sinh', key: 'name', width: 24 },
  { header: 'Giới tính', key: 'gender', width: 14 },
  { header: 'Khối lớp', key: 'grade', width: 10 },
  { header: 'Ngày sinh', key: 'dob', width: 14 },
  { header: 'Lớp học', key: 'className', width: 18 },
  { header: 'Liên hệ', key: 'contact', width: 24 },
];

const header = worksheet.getRow(1);
header.height = 22;
header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
header.alignment = { vertical: 'middle' };

worksheet.addRow({
  name: 'Trần Thị B',
  gender: 'Nữ',
  grade: 6,
  dob: '20/08/2014',
  className: 'Lớp 6A',
  contact: '0384072314',
});

worksheet.getCell('D1').note =
  'Cột Ngày sinh đã được định dạng Text để giữ đúng định dạng dd/mm/yyyy. Nhập ví dụ: 09/05/2014.';
worksheet.getColumn(4).numFmt = '@';

worksheet.getCell('F1').note =
  'Cột Liên hệ đã được định dạng Text để giữ số 0 đầu số điện thoại. Nhập ví dụ: 0384072314, 84384072314, +84384072314 hoặc email.';
worksheet.getColumn(6).numFmt = '@';

for (let row = 2; row <= 101; row += 1) {
  worksheet.getCell(row, 4).numFmt = '@';

  worksheet.getCell(row, 2).dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: ['"Nam,Nữ,Khác"'],
    showErrorMessage: true,
    errorTitle: 'Giới tính không hợp lệ',
    error: 'Chọn Nam, Nữ hoặc Khác.',
  };

  worksheet.getCell(row, 3).dataValidation = {
    type: 'whole',
    operator: 'between',
    allowBlank: false,
    formulae: [1, 12],
    showErrorMessage: true,
    errorTitle: 'Khối lớp không hợp lệ',
    error: 'Nhập số từ 1 đến 12.',
  };

  const contactCell = worksheet.getCell(row, 6);
  contactCell.numFmt = '@';
  contactCell.dataValidation = {
    type: 'custom',
    allowBlank: false,
    formulae: [
      `OR(ISNUMBER(SEARCH("@",F${row})),LEFT(F${row},1)="0",LEFT(F${row},2)="84",LEFT(F${row},3)="+84")`,
    ],
    showErrorMessage: true,
    errorStyle: 'error',
    errorTitle: 'Liên hệ không hợp lệ',
    error: 'Nhập email hoặc số điện thoại dạng text bắt đầu bằng 0, 84 hoặc +84.',
  };
}

await workbook.xlsx.writeFile(outputPath);
