export type ApiProblem = {
  code: string;
  message: string;
  eventId?: `EVT_${string}`;
  requestId: `REQ_${string}`;
  retryable: boolean;
};
