import type { Class } from '../../types';

export async function exportDailyReportPDF(
  dailyReportPdfRef: React.RefObject<HTMLElement | null>,
  setIsExporting: (v: boolean) => void,
  classData: Class | null,
  dailyReportDate: string
) {
  if (!dailyReportPdfRef.current) return;
  setIsExporting(true);

  try {
    const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas'),
    ]);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 15; // mm
    const contentWidth = pageWidth - 2 * margin;

    let currentY = margin;

    // 1. Capture Header
    const header = dailyReportPdfRef.current.querySelector('[data-pdf-header]') as HTMLElement;
    if (header) {
      const canvas = await html2canvas(header, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', margin, currentY, contentWidth, imgHeight);
      currentY += imgHeight + 10;
    }

    // 2. Capture Items
    const items = dailyReportPdfRef.current.querySelectorAll('[data-pdf-item]');
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement;
      const canvas = await html2canvas(item, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const imgHeight = (canvas.height * contentWidth) / canvas.width;

      if (currentY + imgHeight > pageHeight - margin) {
        pdf.addPage();
        // Add background color to new page (white)
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        currentY = margin;
      }

      pdf.addImage(imgData, 'PNG', margin, currentY, contentWidth, imgHeight);
      currentY += imgHeight + 5;
    }

    pdf.save(`DailyReport_${classData?.name || 'Class'}_${dailyReportDate}.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
  } finally {
    setIsExporting(false);
  }
}
