// Middleware de validacao Zod (Sprint 2 / T4).
// Uso: router.post('/path', validate(schemas.foo), handler)

function validate(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      return res.status(400).json({ error: 'validation_error', issues });
    }
    req.body = result.data; // sanitizado (sem campos extras se .strict())
    next();
  };
}

module.exports = { validate };
