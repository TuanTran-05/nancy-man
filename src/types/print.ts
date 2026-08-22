export type PrintRequestStatus = 'pending' | 'printed' | 'completed' | 'rejected' | 'cancelled';

export interface PrintRequestFile {
  id: string;
  originalFilename: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  quantity: number;
}

export interface PrintRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  classId: string;
  className: string;
  neededAt: string;
  neededDate: string;
  createdDate: string;
  status: PrintRequestStatus;
  note?: string;
  files: PrintRequestFile[];
  createdAt: string;
  updatedAt?: string;
  printedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  handledBy?: string;
  handledByName?: string;
  rejectionReason?: string;
}
