-- Migration: Add updated_by, updated_at, execution_result to titular_requests
-- Required by: PATCH /api/admin/titular-requests/:id/status (admin.routes.ts)
-- Date: 2026-04-06

ALTER TABLE titular_requests
  ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS execution_result JSONB;
