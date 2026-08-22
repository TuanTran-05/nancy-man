import { ZaloBotDigestRecipient } from './digestRules.js';

export function composeZaloBotDigest(
  recipient: ZaloBotDigestRecipient,
  input: { digestDate: string; appUrl: string; dryRun: boolean }
): string {
  const lines: string[] = [];

  lines.push(`Báo cáo ngày ${input.digestDate}`);
  if (input.dryRun) {
    lines.push('(Dry Run)');
  }
  lines.push('');

  if (recipient.role === 'teacher') {
    if (recipient.attendance.length > 0) {
      lines.push('Điểm danh còn thiếu:');
      for (const item of recipient.attendance) {
        lines.push(`- ${item.className} (${item.date}): thiếu ${item.missingStudentCount} hv`);
      }
      lines.push('');
    }
    if (recipient.courseClosing.length > 0) {
      lines.push('Sắp kết khóa:');
      for (const item of recipient.courseClosing) {
        lines.push(`- ${item.className}: ${item.endDate} (${item.snapshotStatus})`);
      }
      lines.push('');
    }
  } else if (recipient.role === 'office') {
    if (recipient.printRequests.length > 0) {
      lines.push('Yêu cầu in ấn chờ:');
      for (const item of recipient.printRequests) {
        lines.push(
          `- ${item.neededDate} | ${item.className} | GV: ${item.teacherName} | ${item.fileCount} file, ${item.totalCopies} bản`
        );
      }
      lines.push('');
    }
  } else if (recipient.role === 'admin' && recipient.adminSummary) {
    const sum = recipient.adminSummary;
    lines.push('Admin Summary:');
    lines.push(`- Links: ${sum.linkedRecipients}/${sum.eligibleRecipients}`);
    lines.push(`- Thiếu điểm danh: ${sum.missingAttendanceClasses} lớp`);
    lines.push(`- Sắp kết khóa: ${sum.courseClosingClasses} lớp`);
    lines.push(`- In ấn chờ: ${sum.pendingPrintRequests}`);
    lines.push(`- Lỗi gửi tin: ${sum.outstandingFailedMessages}`);
    if (sum.potentialTruncation.length > 0) {
      lines.push(`- Truncation warnings: ${sum.potentialTruncation.join(', ')}`);
    } else {
      lines.push(`- Truncation warnings: Không có`);
    }
    lines.push('');
  }

  // Remove the very last empty line if we have one so we can control spacing to footer
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const footer = `\n\nXem chi tiết: ${input.appUrl}`;

  const fullText = lines.join('\n') + footer;
  if (fullText.length <= 2000) {
    return fullText;
  }

  const truncationSuffix = '\n...\n' + footer.trimStart();
  let currentLength = 0;
  const truncatedLines = [];

  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for \n in join
    if (currentLength + lineLength + truncationSuffix.length <= 2000) {
      truncatedLines.push(line);
      currentLength += lineLength;
    } else {
      break;
    }
  }

  while (truncatedLines.length > 0 && truncatedLines[truncatedLines.length - 1] === '') {
    truncatedLines.pop();
  }

  return truncatedLines.join('\n') + truncationSuffix;
}
