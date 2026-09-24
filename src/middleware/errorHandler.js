export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: err.issues?.[0]?.message || 'Validation failed',
      details: err.issues || [],
    });
  }
  console.error(err);
  // Both spellings are honoured: parts of this codebase throw `status` and
  // parts throw `statusCode`. Reading only one silently turned a deliberate
  // 503 into a 500, which told the client the server was broken when it was
  // simply not configured for that path.
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
    // A machine-readable code lets the client offer an alternative rather than
    // having to match on the message text.
    ...(err.code && typeof err.code === 'string' && !err.code.startsWith('P')
      ? { code: err.code }
      : {}),
  });
}

