-- Identificador rastreavel por consulta: `CI-2609-K7F3M2`.
--
-- Decisao do dono em 03/09/2026, autorizando a coluna nas tres tabelas. O
-- codigo aparece no topo do relatorio, entra no log do servidor e e o que o
-- provedor apresenta ao suporte. Ate hoje, achar UMA consulta especifica no
-- log significava procurar por CPF — o dado que menos deveria estar la.
--
-- NULLABLE de proposito: as consultas ja gravadas nasceram antes do codigo e
-- nao podem ganhar um retroativo. Um `CI-...` inventado agora para uma consulta
-- de agosto diria que ela foi identificada quando nao foi, e o suporte
-- procuraria no log um codigo que nunca foi escrito la. Linha antiga sem
-- codigo e a verdade.
--
-- O indice e UNICO e PARCIAL. Unico porque o codigo e sorteado: `31^6` da
-- quase 887 milhoes de combinacoes por mes contra alguns milhares de consultas,
-- entao colisao e improvavel — mas "improvavel" nao e "impossivel", e sem o
-- indice duas consultas com o mesmo codigo mandariam o suporte para a consulta
-- errada. Parcial (`WHERE ... IS NOT NULL`) porque as linhas antigas nao
-- precisam entrar nele.
--
-- Idempotente; nenhuma coluna existente e tocada.

ALTER TABLE isp_consultations     ADD COLUMN IF NOT EXISTS consulta_id TEXT;
ALTER TABLE spc_consultations     ADD COLUMN IF NOT EXISTS consulta_id TEXT;
ALTER TABLE bigdata_consultations ADD COLUMN IF NOT EXISTS consulta_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS isp_consultations_consulta_id_uq
  ON isp_consultations (consulta_id) WHERE consulta_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS spc_consultations_consulta_id_uq
  ON spc_consultations (consulta_id) WHERE consulta_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bigdata_consultations_consulta_id_uq
  ON bigdata_consultations (consulta_id) WHERE consulta_id IS NOT NULL;
