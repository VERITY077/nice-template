export class AppError extends Error {
  constructor(status, code, message, hint = '', details = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export class ExtractError extends AppError {
  constructor(code, message, hint = '') {
    const status = code === 'UNSUPPORTED_TYPE' ? 415 : 422;
    super(status, code, message, hint);
    this.name = 'ExtractError';
  }
}

export class AIError extends AppError {
  constructor(code, message, hint = '') {
    let status = 502;
    if (code === 'AI_NOT_CONFIGURED') status = 503;
    if (code === 'AI_TIMEOUT') status = 504;
    if (code === 'AI_AUTH') status = 502;
    super(status, code, message, hint);
    this.name = 'AIError';
  }
}

export class SchemaError extends Error {
  constructor(errors) {
    super(Array.isArray(errors) ? errors.join('；') : String(errors));
    this.name = 'SchemaError';
    this.errors = Array.isArray(errors) ? errors : [String(errors)];
  }
}
