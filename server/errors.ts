export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}
