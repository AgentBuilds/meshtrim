export class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function requireFound(value, resource) {
  if (!value) throw new ApiError(404, 'NOT_FOUND', `${resource} not found`);
  return value;
}
