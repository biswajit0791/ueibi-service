export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}
