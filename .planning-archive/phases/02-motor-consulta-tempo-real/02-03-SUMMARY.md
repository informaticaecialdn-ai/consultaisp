---
plan: 02-03
phase: 02-motor-consulta-tempo-real
status: complete
started: 2026-04-01T17:50:00Z
completed: 2026-04-01T17:55:00Z
---

## Summary

Wired consultation cache into POST /api/isp-consultations route. Added score100 (0-100) mapping from internal 0-1000 score. Added erpSummary with total/responded/failed/timedOut counts. Cache hits return source="cache" with cacheAge in seconds.

## Tasks

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Wire cache + score100 + erpSummary | Done | 7f9aac1 |

## Self-Check: PASSED

- [x] consultationCache imported and used
- [x] Cache check before ERP query
- [x] Cache store after consultation saved
- [x] score100 computed and in result
- [x] erpSummary with total/responded/failed/timedOut
- [x] GET handler, SPC handlers, LGPD masking unchanged

## Key Files

### Modified
- `server/routes/consultas.routes.ts` — Cache layer + score100 + erpSummary

## Deviations

None.

## Requirements Addressed

- RT-01: POST /api/isp-consultations dispara chamadas paralelas aos ERPs regionais
- RT-03: Score ISP 0-100 calculado e retornado
- RT-05: Resultado respeita mascaramento LGPD
- CACHE-01: Cache de resultado por CPF com TTL curto
- CACHE-02: Consulta repetida retorna cache sem ir aos ERPs
