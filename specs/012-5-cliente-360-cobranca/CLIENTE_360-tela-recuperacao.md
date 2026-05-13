# Cliente 360° — Recuperação Pós-Cancelamento

> Tela/payload para **ex-clientes** com dois objetivos paralelos: recuperação
> financeira (Daniel D+60+) + recuperação de equipamentos comodato (Lucas).
> Realidade diferente do CLIENTE_360_COBRANCA.md (que assume cliente ativo).
> Aqui o contrato JÁ ACABOU, e a régua é outra.

**Audiência**: Daniel (Recuperação Financeira), Lucas (Equipamentos), Marcos
(coordenador), Operador humano financeiro/jurídico.

**Pareado com**: CLIENTE_360.md (schema geral), CLIENTE_360_COBRANCA.md
(cliente ativo), DESIGN.md (visual), provedor-cobranca-juridica skill.

---

## 1. Diferenças críticas vs. cobrança de cliente ativo

| Aspecto | Cobrança ativa (CLIENTE_360_COBRANCA) | Recuperação pós-cancelamento (este doc) |
|---|---|---|
| Status do contrato | Ativo, suspenso parcial/total, em acordo | **CANCELADO** |
| Relação | Preservar (cliente paga e fica) | **Encerrada** — recuperar dívida sem ferir lei |
| Agentes ativos | Helena, Bruno, Rafael, Carla, Sofia, Pedro | **Daniel + Lucas + Marcos coord** (outros pausados) |
| Régua DNA | A1-C3 calibra tom/cadência/desconto | **N/A** — cliente saiu (perfil congelado no momento do cancelamento) |
| Janela Meta 24h | Crítica (Helena precisa dela) | Inbound raro (cliente já saiu) |
| Tom recomendado | varia por perfil | **direto, formal, fundamentado** |
| Descontos máximos | até 30% policy | **até 70%** (ex-cliente, autonomia maior) |
| Suspensão Anatel | crítico (D+15) | já aconteceu OU não se aplica (já cancelado) |
| Negativação SPC/Serasa | só após anuência prévia (D+30+) | foco principal Daniel |
| Equipamentos | informativos | **CRÍTICO** — Lucas atua paralelo |
| ROI obrigatório | recomendado | **OBRIGATÓRIO** (não jogar dinheiro fora) |
| Decisão "arquivar" | rara (cliente ativo é receita) | **frequente** se ROI<0.3 |
| Loop Consulta ISP | informativo | **MOAT principal** — registra evento de inadimplência |
| Pesquisa NPS | sim (Pedro pós-pagamento) | **NÃO** (cliente saiu) |
| Sofia agradecimento | a cada pagamento | só quando acordo cumprido |

---

## 2. Princípios desta operação

1. **Ex-cliente NÃO é cliente.** Tom muda. Não tente preservar relacionamento que já acabou — recupere o que é seu dentro da lei.

2. **Dois fluxos PARALELOS, não sequenciais.** Daniel cobra a dívida financeira, Lucas recupera o equipamento. Coordenam mas não dependem um do outro. Cliente pode devolver equipamento sem pagar dívida (e vice-versa).

3. **ROI > 0.3 obrigatório.** Cada ação tem custo (negativação R$5, protesto R$50, motoboy R$25). Se valor esperado da recuperação não cobre custo + margem, **ARQUIVAR**. Marcos comunica owner com fundamentação econômica.

4. **Compliance ex-cliente é MAIS rigoroso.** Cliente cancelou → pode estar irritado → maior risco Procon. Júlia aplica gates mais conservadores.

5. **Loop Consulta ISP é o moat.** Quando Daniel negativa, automaticamente registra evento na rede de provedores. Outros provedores consultam antes de instalar → ex-cliente inadimplente paga upfront ou não consegue contratar. Isso reduz inadimplência sistêmica do mercado.

6. **Reconquista é possível.** Cliente pode voltar. Mostre porta aberta sem ceder em cobrança ativa. "Quer voltar quando regularizar? A gente te recebe."

7. **Equipamento NUNCA é tratado como roubo.** CDC 39 V proíbe cobrar valor de mercado >mercado. Termo de comodato precisa ser fundamentado. Tom = "vamos resolver", não "você é ladrão".

---

## 3. Estrutura consolidada (JSON específico)

Endpoint: `GET /api/customers/:id/recuperacao`

```json
{
  "cliente_id": "uuid",
  "ex_cliente": true,
  "status_recuperacao": "ativo|arquivado|em_acordo|finalizado",

  "header": {
    "nome": "Maria Silva Souza",
    "cpf_cnpj_masked": "123.***.**-12",
    "idade": 45,
    "cidade_uf": "Cambé/PR",
    "telefones_masked": ["+55 11 *****1234"],
    "email": "maria@exemplo.com",
    "data_cadastro": "2023-08-15",
    "data_cancelamento": "2026-07-15",
    "tempo_como_cliente_meses": 35,
    "perfil_no_cancelamento": "C2",
    "motivo_cancelamento": "inadimplencia_anatel_d60",
    "motivo_canc_descricao": "Rescisão automática Anatel D+60 após 75 dias suspenso. Não regularizou.",
    "ultimo_perfil_30d_antes_canc": "C2",
    "divida_total_centavos": 32850,
    "estagio_atual": "estagio_2_pre_negativacao",
    "dias_desde_cancelamento": 28
  },

  "divida_financeira": {
    "total_centavos": 28800,
    "faturas_em_aberto": [
      {
        "fatura_id": "uuid",
        "numero": "4521",
        "data_vencimento": "2026-04-10",
        "dias_atraso": 95,
        "principal_centavos": 8990,
        "multa_centavos": 180,
        "juros_centavos": 285,
        "total_centavos": 9455
      },
      {
        "fatura_id": "uuid",
        "numero": "4587",
        "data_vencimento": "2026-05-10",
        "dias_atraso": 65,
        "principal_centavos": 8990,
        "multa_centavos": 180,
        "juros_centavos": 195,
        "total_centavos": 9365
      },
      {
        "fatura_id": "uuid",
        "numero": "4621",
        "data_vencimento": "2026-06-10",
        "dias_atraso": 35,
        "principal_centavos": 8990,
        "multa_centavos": 180,
        "juros_centavos": 105,
        "total_centavos": 9275
      }
    ],
    "anuencia_previa_enviada_em": "2026-08-05",
    "data_minima_negativacao": "2026-08-19",
    "ja_pode_negativar": true,
    "negativacoes_ativas": [],
    "protesto_disponivel": false,
    "prescricao_em": "2031-04-10",
    "anos_ate_prescricao": 5
  },

  "divida_equipamentos": {
    "total_centavos": 25500,
    "equipamentos_pendentes": [
      {
        "equipamento_id": "uuid",
        "tipo": "ONU",
        "modelo": "ZTE F660",
        "serial": "ZTE-XYZ-123",
        "mac_address": "AA:BB:CC:DD:EE:FF",
        "data_instalacao": "2023-08-20",
        "meses_uso": 35,
        "valor_aquisicao_centavos": 25000,
        "valor_reposicao_calculado_centavos": 17500,
        "valor_compra_oferta_centavos": 12250,
        "termo_comodato_assinado": true,
        "termo_id": "uuid",
        "status_pos_cancelamento": "aguardando_devolucao",
        "dias_aguardando_devolucao": 28,
        "tentativas_contato": 3,
        "ultimo_status_mac": "ativo_em_outro_provedor",
        "alerta_revenda_ilegal": true
      },
      {
        "equipamento_id": "uuid",
        "tipo": "roteador",
        "modelo": "TP-Link Archer C20",
        "serial": "TPL-789",
        "valor_aquisicao_centavos": 12000,
        "valor_reposicao_calculado_centavos": 8000,
        "valor_compra_oferta_centavos": 5600,
        "status_pos_cancelamento": "aguardando_devolucao"
      }
    ]
  },

  "motivo_cancelamento_analise": {
    "categoria": "inadimplencia",
    "subcategoria": "anatel_d60_rescisao_automatica",
    "post_mortem": {
      "cliente_tentou_negociar": true,
      "ofertas_recusadas": ["3x desconto 20%", "downgrade temporário"],
      "ultima_resposta_cliente": "Estou desempregado, não tenho como pagar agora.",
      "sentiment_30d_antes_cancelamento": [0.1, -0.2, -0.4, -0.6, -0.7],
      "sinal_vulneravel_detectado_em": "2026-06-15",
      "vulneravel_confirmado": false,
      "operador_tentou_reter": true,
      "razao_falha_retencao": "cliente não respondeu mais"
    },
    "lessons_learned": [
      "Sinal vulnerável detectado em 15/06 mas não confirmado a tempo (Lei 14.181)",
      "Retenção humana acionada D+45 — talvez tarde demais",
      "Cliente C2 com queda de sentiment severa nos 30d antes do cancelamento — sinal de churn"
    ]
  },

  "historico_recuperacao": {
    "contatos_feitos": [
      {
        "data": "2026-07-20",
        "canal": "whatsapp",
        "agente": "daniel",
        "tipo": "abordagem_amigavel_d5",
        "oferta": "desconto_10pct",
        "resposta_cliente": "ignorou",
        "outcome": "sem_resposta"
      },
      {
        "data": "2026-07-28",
        "canal": "whatsapp",
        "agente": "daniel",
        "tipo": "abordagem_amigavel_d13",
        "oferta": "desconto_20pct",
        "resposta_cliente": "ignorou",
        "outcome": "sem_resposta"
      },
      {
        "data": "2026-08-03",
        "canal": "whatsapp+sms+email",
        "agente": "daniel",
        "tipo": "abordagem_amigavel_d19_ultima",
        "oferta": "desconto_30pct_a_vista",
        "resposta_cliente": "ignorou",
        "outcome": "sem_resposta"
      },
      {
        "data": "2026-08-05",
        "canal": "whatsapp+sms+email+pdf",
        "agente": "daniel",
        "tipo": "anuencia_previa_cdc_43p2",
        "fontes_legais": ["CDC art. 43 §2", "Súmula 359 STJ"],
        "comprovacao_entrega": {
          "whatsapp_lido_em": "2026-08-05T18:30:00Z",
          "sms_entregue": true,
          "email_aberto_em": "2026-08-06T09:00:00Z"
        },
        "outcome": "comprovado_aguardando_prazo"
      }
    ],
    "total_tentativas": 4,
    "respostas_recebidas": 0,
    "ofertas_aceitas": 0,
    "ofertas_recusadas": 0,
    "taxa_resposta": 0
  },

  "predicoes_ml_recuperacao": {
    "prob_pagamento_acordo": 0.18,
    "prob_pagamento_acordo_classificacao": "BAIXO",
    "prob_devolucao_voluntaria_equipamento": 0.22,
    "prob_compra_equipamento": 0.15,
    "prob_litigio_judicial": 0.08,
    "prob_reconquista_12m": 0.05,
    "modelo_versao": "v1.2.3",
    "calculado_em": "2026-08-13T06:00:00Z"
  },

  "scores_externos": {
    "consulta_isp_score": 380,
    "consulta_isp_eventos_negativos": 0,
    "consulta_isp_outras_inadimplencias": 0,
    "spc_status": "limpo",
    "serasa_status": "limpo",
    "outras_inadimplencias_no_bureau": 0
  },

  "decisao_economica": {
    "valor_total_a_recuperar_centavos": 54300,
    "prob_recuperacao_total": 0.18,
    "valor_esperado_centavos": 9774,
    "custos_por_estagio": {
      "estagio_amigavel_d60_d75": 90,
      "estagio_anuencia_d76_d90": 90,
      "estagio_negativacao_d91_d120": 500,
      "estagio_protesto_d121_d180": 5000,
      "estagio_cessao_d180_plus": 1000
    },
    "custo_total_se_executar_todos_estagios": 6680,
    "roi_estimado": 1.46,
    "recomendacao": "PROSSEGUIR_ATE_ESTAGIO_3",
    "ponto_de_arquivamento_sugerido": "se_estagio_3_negativacao_nao_recuperar_em_30d_arquivar",
    "rationale": "ROI 1.46x positivo mas marginal. Negativação D+91 tem boa relação custo-benefício. Protesto D+121 só se dívida >R$ 200 (sim). Cessão D+180 desnecessária se já negativado.",
    "alternativa_arquivar_agora": {
      "perda_evitada_centavos": 6680,
      "valor_perdido_centavos": 9774,
      "recomendacao": "NAO_ARQUIVAR_AINDA"
    }
  },

  "estagios_recuperacao": {
    "atual": "estagio_2_pre_negativacao",
    "linha_temporal": [
      {
        "estagio": "estagio_1_amigavel",
        "periodo": "D+60 a D+75",
        "status": "concluido",
        "outcome": "sem_resposta",
        "ofertas": ["10%", "20%", "30%"],
        "data_inicio": "2026-07-20",
        "data_fim": "2026-08-04"
      },
      {
        "estagio": "estagio_2_pre_negativacao",
        "periodo": "D+76 a D+90",
        "status": "EM_CURSO",
        "data_inicio": "2026-08-05",
        "data_envio_anuencia": "2026-08-05",
        "data_minima_negativar": "2026-08-19",
        "dias_uteis_decorridos": 7,
        "dias_uteis_restantes": 3,
        "fontes_legais": ["CDC art. 43 §2", "Súmula 359 STJ"]
      },
      {
        "estagio": "estagio_3_negativacao",
        "periodo": "D+91 a D+120",
        "status": "previsto",
        "data_inicio_prevista": "2026-08-19",
        "acao": "incluir_spc_serasa",
        "requer_julia_gate": true
      },
      {
        "estagio": "estagio_4_protesto",
        "periodo": "D+121 a D+180",
        "status": "condicional",
        "condicao": "dívida >R$ 200 + sem disputa judicial + Júlia OK",
        "data_inicio_prevista": "2026-09-18"
      },
      {
        "estagio": "estagio_5_cessao",
        "periodo": "D+180+",
        "status": "ultima_opcao",
        "data_inicio_prevista": "2026-11-17",
        "desconto_aceitavel_centavos_pct": 60
      }
    ]
  },

  "estagios_equipamento_lucas": {
    "atual": "tentativa_3_downsell",
    "linha_temporal": [
      {
        "estagio": "dia_0_3_caminhos",
        "data": "2026-07-15",
        "status": "concluido",
        "opcoes_oferecidas": ["devolucao_gratuita", "compra_70pct", "cobranca_formal"],
        "outcome": "cliente_ignorou"
      },
      {
        "estagio": "dia_3_reforco",
        "data": "2026-07-18",
        "status": "concluido",
        "outcome": "cliente_ignorou"
      },
      {
        "estagio": "dia_7_downsell",
        "data": "2026-07-22",
        "status": "EM_CURSO",
        "acao": "compra_com_desconto_adicional_10pct",
        "valor_compra_atual_centavos": 12250,
        "outcome": "aguardando_resposta"
      },
      {
        "estagio": "dia_15_notificacao_formal",
        "data_prevista": "2026-07-30",
        "status": "previsto"
      },
      {
        "estagio": "dia_30_cobranca_via_daniel",
        "data_prevista": "2026-08-14",
        "status": "previsto",
        "acao": "soma_divida_equipamento_a_negativacao"
      },
      {
        "estagio": "dia_60_pequenas_causas",
        "data_prevista": "2026-09-13",
        "status": "condicional",
        "condicao": "valor >R$ 500 + termo bem fundamentado + endereço válido + escalar humano"
      }
    ],
    "alerta_revenda_ilegal": {
      "detectado": true,
      "evidencia": "MAC AA:BB:CC:DD:EE:FF ativo em outro provedor (Consulta ISP)",
      "acao_recomendada": "evidencia_extra_para_cobranca_formal_judicial"
    }
  },

  "compliance_ex_cliente": {
    "vulneravel": {
      "status": "suspeita_nao_confirmada",
      "sinal": "Cliente disse 'estou desempregado' em 15/06 (durante negociação ativa)",
      "acao_disponivel": "humano_validar_se_vulneravel_dispensar_cobranca"
    },
    "binding_procon": { "status": "ok" },
    "super_endividado": {
      "status": "ok",
      "info": "Consulta ISP não reporta outras inadimplências"
    },
    "menor_de_idade": { "status": "ok" },
    "prescrita_cc206": {
      "status": "ok",
      "anos_ate_prescricao": 5,
      "data_prescricao": "2031-04-10",
      "alerta_60_meses_antes": "2030-10-10"
    },
    "servico_essencial": { "status": "nao_declarado" },
    "falecido": {
      "status": "ok",
      "info": "Sem inventário aberto na rede colaborativa"
    },
    "boleto_falso_circulando": {
      "detectado": false,
      "info": "Sem evidência de fraude"
    },
    "termo_comodato_valido": {
      "status": "valido",
      "termo_id": "uuid",
      "assinatura_validada": true,
      "valor_declarado_coerente_mercado": true
    }
  },

  "proximas_acoes_recomendadas": [
    {
      "rank": 1,
      "tipo": "AGUARDAR_PRAZO_LEGAL",
      "acao": "Aguardar 3 dias úteis restantes Súmula 359 STJ",
      "razao": "Anuência prévia enviada 05/08, prazo mínimo 19/08. Júlia bloqueia negativação antes disso.",
      "data_acao": "2026-08-19",
      "agente_responsavel": "daniel",
      "fontes_legais": ["CDC 43 §2", "Súmula 359 STJ"]
    },
    {
      "rank": 2,
      "tipo": "LUCAS_OFERTA_FINAL_EQUIPAMENTO",
      "acao": "Lucas notificação formal coleta equipamento D+15",
      "razao": "3 tentativas sem resposta. Próximo passo é cobrança formal valor cheio R$ 175.",
      "data_acao": "2026-07-30",
      "agente_responsavel": "lucas",
      "alerta_revenda_ilegal": "MAC ativo em outro provedor — evidência para ação judicial se necessário"
    },
    {
      "rank": 3,
      "tipo": "AVALIAR_CONFIRMAR_VULNERAVEL",
      "acao": "Validar com humano se 'estou desempregado' (15/06) configura Lei 14.181",
      "razao": "Se confirmar vulnerabilidade, dispensa cobrança e Marcos comunica owner.",
      "agente_responsavel": "humano_juridico",
      "fontes_legais": ["Lei 14.181/2021", "CDC arts. 54-A a 54-G"]
    }
  ],

  "decisao_arquivar": {
    "recomendacao": "NAO_ARQUIVAR_AINDA",
    "razao": "ROI positivo 1.46x até estágio 3. Reavaliar após D+120 se sem recuperação.",
    "condicoes_para_arquivar_futuro": [
      "Se cliente confirmar vulnerabilidade (Lei 14.181)",
      "Se cliente falecer sem inventário",
      "Se dívida prescrever (>5 anos)",
      "Se estágio 3 negativação não recuperar em 30 dias",
      "Se estágio 4 protesto não recuperar em 60 dias",
      "Se ROI cair abaixo de 0.3 em recálculo mensal"
    ]
  },

  "loop_consulta_isp": {
    "evento_registrado": false,
    "data_registro_prevista": "2026-08-19",
    "evento_a_registrar": "inadimplencia_confirmada",
    "valor_centavos": 28800,
    "data_evento": "2026-07-15",
    "impacto_rede": "Outros provedores consultam ConsultaISP antes de instalar este CPF. Score de Maria cairá para ~200, exigirá Pix upfront ou bloqueio.",
    "valor_estrategico_rede": "moat_principal_provedor_ai"
  },

  "potencial_reconquista": {
    "score": 0.25,
    "classificacao": "BAIXA",
    "razoes": [
      "Cliente cancelou por inadimplência (não voluntário)",
      "Sentiment severamente negativo nos últimos 30 dias",
      "Não respondeu nenhuma das 4 tentativas pós-cancelamento",
      "Mencionou 'desempregado' — questão financeira não resolvida"
    ],
    "estrategia_reconquista": "PASSIVA: aguardar 6-12 meses. Se cliente voltar e quiser contratar, exigir Pix de instalação + 3 primeiras mensalidades upfront + plano básico inicial.",
    "ofertas_proibidas_neste_momento": [
      "qualquer comunicação comercial",
      "telemarketing voluntário",
      "spam de promoções"
    ]
  },

  "audit_julia_ex_cliente": {
    "decisoes_recentes": [
      {
        "data": "2026-08-13T08:00:00Z",
        "agent_origem": "daniel",
        "acao_avaliada": "incluir_negativacao_spc_serasa",
        "decisao": "BLOQUEADO",
        "motivo": "Aguardar 3 dias úteis restantes Súmula 359 STJ. Data mínima: 19/08/2026.",
        "fontes_legais": ["CDC 43 §2", "Súmula 359 STJ"]
      },
      {
        "data": "2026-08-05T10:00:00Z",
        "agent_origem": "daniel",
        "acao_avaliada": "enviar_anuencia_previa_cdc_43p2",
        "decisao": "APROVADO",
        "motivo": "Estágio 2 cumprido. 3 tentativas amigáveis sem resposta. Notificação tripla obrigatória OK.",
        "fontes_legais": ["CDC 43 §2", "Súmula 359 STJ", "Súmula 404 STJ"]
      },
      {
        "data": "2026-07-15T16:00:00Z",
        "agent_origem": "marcos",
        "acao_avaliada": "iniciar_recuperacao_pos_cancelamento",
        "decisao": "APROVADO_COM_AJUSTE",
        "motivo": "Cliente possivelmente vulnerável (sinal em 15/06). Sugerido humano validar antes de prosseguir cobrança agressiva.",
        "fontes_legais": ["Lei 14.181/2021"]
      }
    ]
  },

  "carteira_atribuida": {
    "portfolio_recuperacao_id": "uuid",
    "portfolio_nome": "Recuperação Cambé",
    "operador_responsavel": {
      "id": "uuid",
      "nome": "João Recuperação",
      "telefone_e164": "+5511955554444"
    }
  },

  "metadados": {
    "ultima_atualizacao": "2026-08-13T08:30:00Z",
    "ultima_recalculo_predicoes": "2026-08-13T06:00:00Z",
    "schema_version": "1.0"
  }
}
```

---

## 4. Layout sugerido (wireframe ASCII)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ HEADER EX-CLIENTE (não sticky para baixo)                                    │
│                                                                              │
│ 🚫 EX-CLIENTE  Maria Silva Souza  CPF 123.***.**-12                          │
│    Cancelado em 15/07/2026 (28 dias atrás)                                   │
│    Motivo: rescisão automática Anatel D+60                                   │
│    Foi cliente por 35 meses (perfil C2 no cancelamento)                      │
│                                                                              │
│ 💰 DÍVIDA TOTAL  R$ 543,00  =  R$ 288,00 financeiro  +  R$ 255,00 equipamento│
│ 📊 PROB. RECUPERAÇÃO  18%  |  ROI ESTIMADO  1.46×  |  Estágio 2 (D+90)       │
│                                                                              │
│ [▶️ AÇÕES RECUPERAÇÃO] [📋 Histórico] [⚖️ Compliance] [📦 Equipamentos]    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┬──────────────────────────────────────────┐
│ COLUNA ESQUERDA (40%)            │ COLUNA DIREITA (60%)                     │
│                                  │                                          │
│ 📉 ANÁLISE POST-MORTEM           │ 💰 DÍVIDA FINANCEIRA                    │
│ ┌──────────────────────────────┐ │ ┌──────────────────────────────────────┐ │
│ │ Motivo: rescisão Anatel D+60 │ │ │ Total: R$ 288,00 (3 faturas)         │ │
│ │ Última oferta: 3x 20%        │ │ │                                      │ │
│ │ Cliente disse 14d antes:     │ │ │ Fat #4521 (abr) — D+95               │ │
│ │ "Estou desempregado"         │ │ │   R$ 89,90 + 2% + 3.17%j = R$ 94,55  │ │
│ │ ⚠️ Sinal vulnerável NÃO      │ │ │ Fat #4587 (mai) — D+65               │ │
│ │    confirmado                │ │ │   R$ 89,90 + 2% + 2.17%j = R$ 93,65  │ │
│ │ Sentiment 30d antes: pioria  │ │ │ Fat #4621 (jun) — D+35               │ │
│ │ [-0.7, -0.6, -0.4, -0.2, 0.1]│ │ │   R$ 89,90 + 2% + 1.17%j = R$ 92,75  │ │
│ │                              │ │ │                                      │ │
│ │ Lessons learned:             │ │ │ Anuência prévia: ENVIADA 05/08       │ │
│ │ - retenção tarde (D+45)      │ │ │   Lida em: 05/08 18:30              │ │
│ │ - sinal vuln. não detectado  │ │ │ Negativação liberada: 19/08 (3 dias)│ │
│ │ - C2 queda sentiment severa  │ │ │ [Negativar SPC+Serasa] (bloqueado)   │ │
│ └──────────────────────────────┘ │ └──────────────────────────────────────┘ │
│                                  │                                          │
│ 🗓️ HISTÓRICO DE RECUPERAÇÃO      │ 📦 DÍVIDA EQUIPAMENTOS (Lucas)          │
│ ┌──────────────────────────────┐ │ ┌──────────────────────────────────────┐ │
│ │ 4 tentativas / 0 respostas   │ │ │ Total: R$ 255,00                     │ │
│ │ Taxa resposta: 0%            │ │ │                                      │ │
│ │                              │ │ │ ┌──────────────────────────────────┐ │
│ │ 20/07 WhatsApp D+5 amigável  │ │ │ │ ONU ZTE F660  (35 meses uso)     │ │
│ │   Oferta 10% — sem resposta  │ │ │ │ Reposição calculada: R$ 175,00   │ │
│ │ 28/07 WhatsApp D+13 reforço  │ │ │ │ Oferta compra: R$ 122,50 (-30%)  │ │
│ │   Oferta 20% — sem resposta  │ │ │ │ Status: aguardando há 28 dias    │ │
│ │ 03/08 Tripla D+19 última     │ │ │ │ 🚨 MAC ativo em outro provedor   │ │
│ │   Oferta 30% — sem resposta  │ │ │ │    (possível revenda ilegal)     │ │
│ │ 05/08 Anuência prévia CDC    │ │ │ └──────────────────────────────────┘ │
│ │   Tripla comprovada          │ │ │ ┌──────────────────────────────────┐ │
│ └──────────────────────────────┘ │ │ │ Roteador TP-Link TC20            │ │
│                                  │ │ │ Reposição: R$ 80,00              │ │
│ 🎯 PREDIÇÕES RECUPERAÇÃO         │ │ │ Oferta compra: R$ 56,00          │ │
│ ┌──────────────────────────────┐ │ │ │ Status: aguardando há 28 dias    │ │
│ │ Prob pagamento acordo:       │ │ │ └──────────────────────────────────┘ │
│ │   18% ██░░░░░░░ BAIXO        │ │ │                                      │
│ │ Prob devolução equipamento:  │ │ │ [Notificação formal D+15] [Pequenas] │
│ │   22% ███░░░░░░ BAIXO        │ │ │ [Renunciar e arquivar equipamento]   │
│ │ Prob compra equipamento:     │ │ └──────────────────────────────────────┘ │
│ │    15% ██░░░░░░░ BAIXO       │ │                                          │
│ │ Prob litígio judicial:       │ │ 🎬 PRÓXIMAS AÇÕES (Daniel + Lucas)      │
│ │    8% █░░░░░░░░ BAIXO        │ │ ┌──────────────────────────────────────┐ │
│ │ Prob reconquista 12m:        │ │ │ 1. ⏳ AGUARDAR 3 DIAS ÚTEIS          │ │
│ │    5% █░░░░░░░░ MUITO BAIXO  │ │ │    Súmula 359 STJ — negativar 19/08  │ │
│ │                              │ │ │    Júlia bloqueia antes disso.       │ │
│ │ Score Consulta ISP atual:380 │ │ │                                      │ │
│ │ (cairá para ~200 ao negativ) │ │ │ 2. ⚠️ LUCAS NOTIFICAÇÃO FORMAL D+15  │ │
│ └──────────────────────────────┘ │ │    Equipamento R$ 175 boleto enviado │ │
│                                  │ │    + evidência MAC ativo em outro    │ │
│ 💸 DECISÃO ECONÔMICA (ROI)       │ │      provedor (revenda ilegal)       │ │
│ ┌──────────────────────────────┐ │ │                                      │ │
│ │ Valor a recuperar: R$ 543,00 │ │ │ 3. 👤 HUMANO VALIDAR VULNERABILIDADE │ │
│ │ Prob recuperação:  18%       │ │ │    "Estou desempregado" detectado    │ │
│ │ Valor esperado:    R$ 97,74  │ │ │    em 15/06. Confirmar Lei 14.181?   │ │
│ │ Custo total:       R$ 66,80  │ │ │    Se sim, DISPENSAR cobrança.       │ │
│ │ ────────────────             │ │ │                                      │ │
│ │ ROI:               1.46×     │ │ │ ❌ NÃO RECOMENDADO:                  │ │
│ │ Decisão: PROSSEGUIR          │ │ │ - Cobrança ostensiva diária (CDC 42) │ │
│ │ Reavaliar após D+120         │ │ │ - Protesto antes de D+121            │ │
│ │                              │ │ │ - Cessão assessoria antes de D+180   │ │
│ │ [Re-calcular ROI] [Arquivar] │ │ └──────────────────────────────────────┘ │
│ └──────────────────────────────┘ │                                          │
│                                  │ 🌐 LOOP CONSULTA ISP                    │
│ ⚖️ COMPLIANCE EX-CLIENTE         │ ┌──────────────────────────────────────┐ │
│ ┌──────────────────────────────┐ │ │ Evento a registrar:                  │ │
│ │ Vulnerável (14.181): SUSPEITA│ │ │   inadimplencia_confirmada           │ │
│ │   "desempregado" 15/06       │ │ │   R$ 288,00 + R$ 255,00 = R$ 543,00  │ │
│ │   [Confirmar e dispensar]    │ │ │ Data registro: 19/08/2026            │ │
│ │ Binding Procon:     OK       │ │ │                                      │ │
│ │ Super endividado:   OK       │ │ │ Impacto na rede:                     │ │
│ │ Menor:              OK       │ │ │ Score ConsultaISP cairá: 380 → ~200  │ │
│ │ Prescrição CC 206:  OK (5a)  │ │ │ Outros provedores exigirão Pix       │ │
│ │ Serviço essencial:  n/a      │ │ │   upfront se Maria tentar contratar  │ │
│ │ Falecido:           OK       │ │ │                                      │ │
│ │ Boleto falso:       não      │ │ │ ⭐ Este é o moat principal           │ │
│ │ Termo comodato:     ✓ válido │ │ │    do Provedor.AI                    │ │
│ └──────────────────────────────┘ │ └──────────────────────────────────────┘ │
└──────────────────────────────────┴──────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚖️ TIMELINE DE RECUPERAÇÃO (5 estágios)                                      │
│                                                                              │
│   D+60   D+75    D+76    D+90    D+91    D+120   D+121   D+180   D+180+    │
│    ●─────●───────●───────●───────│───────◯───────◯───────◯───────◯          │
│ amigável amigável anuência   3 dias  negativar  manter  protesto  cessão    │
│ (10%)  (20%)  (30%)  (CDC43§2)úteis  SPC+Serasa cobrança cartório assessor │
│                              restantes                                      │
│                                                                              │
│   ✅ Estágio 1 concluído (sem resposta)                                      │
│   ⏳ Estágio 2 EM CURSO — aguardando prazo Súmula 359 (3 dias úteis)         │
│   ◯ Estágio 3 previsto 19/08 — negativação SPC+Serasa (Júlia gate)          │
│   ◯ Estágio 4 condicional 18/09 — protesto se dívida >R$ 200 sem disputa    │
│   ◯ Estágio 5 última opção 17/11 — cessão assessoria com desconto até 60%   │
│                                                                              │
│ PARALELO — LUCAS EQUIPAMENTOS:                                               │
│   ✅ Dia 0 (3 caminhos)  ✅ Dia 3 (reforço)  🟡 Dia 7 (downsell -10%)        │
│   ◯ Dia 15 (notificação formal)  ◯ Dia 30 (junta à negativação Daniel)      │
│   ◯ Dia 60 (avaliar pequenas causas — escalar humano)                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ AUDIT JÚLIA — DECISÕES NESTE EX-CLIENTE                                   │
│                                                                              │
│ 13/08 08:00  ❌ BLOQUEADO   daniel.incluir_negativacao_spc_serasa            │
│              motivo: aguardar 3 dias úteis restantes Súmula 359 STJ          │
│              fonte: CDC 43 §2, Súmula 359 STJ                                │
│                                                                              │
│ 05/08 10:00  ✅ APROVADO    daniel.enviar_anuencia_previa_cdc                │
│              fonte: CDC 43 §2, Súmula 359 STJ, Súmula 404 STJ (dispensa AR) │
│                                                                              │
│ 15/07 16:00  ⚠️ APROVADO COM AJUSTE  marcos.iniciar_recuperacao              │
│              motivo: cliente possivelmente vulnerável Lei 14.181             │
│              ajuste: humano validar antes de cobrança agressiva              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ 🔄 POTENCIAL RECONQUISTA                                                     │
│                                                                              │
│ Score reconquista: 0.25 / 1.0 — BAIXA                                        │
│ Estratégia: PASSIVA (aguardar 6-12 meses)                                    │
│                                                                              │
│ Se cliente voltar a procurar:                                                │
│ - Exigir Pix de instalação + 3 mensalidades upfront                          │
│ - Plano básico inicial (R$ 59,90)                                            │
│ - Monitoramento 90 dias antes de upgrade                                     │
│ - Score ConsultaISP precisa ter melhorado                                    │
│                                                                              │
│ ❌ Marketing ativo PROIBIDO neste momento (cliente está irritado)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Cards detalhados específicos

### Card 1 — HEADER EX-CLIENTE

Diferenças do header de cliente ativo:
- Badge "🚫 EX-CLIENTE" em vez de perfil DNA
- Data e motivo do cancelamento em destaque
- Dívida total = financeiro + equipamentos
- Estágio atual do funil pós-cancelamento (1-5)
- ROI estimado no topo (decisão econômica visível)
- Sem indicador de status de serviço (já cancelado)

### Card 2 — ANÁLISE POST-MORTEM (lessons learned)

Único deste contexto. Mostra:
- Categoria de cancelamento (inadimplência, voluntário, mudança)
- Subcategoria precisa (anatel_d60, cliente_pediu, mudou_endereço, plano_caro)
- Tentativas de retenção feitas + por que falharam
- Sentiment dos 30 dias antes (gráfico mostra deterioração)
- Sinais não detectados a tempo (ex: vulnerável)
- **Lessons learned** — virá dataset para Pedro melhorar prevenção churn

### Card 3 — HISTÓRICO DE RECUPERAÇÃO

Tentativas feitas pós-cancelamento por estágio:
- Data + canal + agente + tipo + oferta + resposta + outcome
- Taxa de resposta acumulada (importante para ROI)
- Comprovação de entrega das notificações formais (defesa em juízo)

### Card 4 — PREDIÇÕES ML RECUPERAÇÃO

Probabilidades específicas do contexto ex-cliente:
- Prob pagamento de acordo (não "próxima fatura")
- Prob devolução voluntária equipamento
- Prob compra equipamento (downsell)
- Prob litígio judicial (cliente vai processar)
- Prob reconquista 12m (cliente volta voluntariamente)

### Card 5 — DECISÃO ECONÔMICA (ROI) — CARD CENTRAL

Este é o card mais importante. Mostra:
- Valor a recuperar (dinheiro + equipamentos)
- Custos previstos por estágio
- Valor esperado (valor × prob)
- ROI estimado
- **Recomendação**: PROSSEGUIR | ARQUIVAR | AGUARDAR
- Rationale humano-legível
- Botão `[Recalcular ROI]` e `[Arquivar caso]`

Se ROI < 0.3 → recomendação ARQUIVAR com explicação para Marcos comunicar owner.

### Card 6 — DÍVIDA FINANCEIRA

Lista faturas em aberto com cálculo de encargos atualizado.
Mostra status da anuência prévia (CDC 43 §2 + Súmula 359 STJ):
- Enviada em DD/MM
- Comprovação de entrega (WhatsApp lido, SMS entregue, email aberto)
- Data mínima para negativar
- Dias úteis restantes
- Botão `[Negativar SPC+Serasa]` (habilitado/desabilitado conforme prazo)

### Card 7 — DÍVIDA EQUIPAMENTOS (Lucas)

Lista equipamentos pendentes com:
- Valor aquisição vs reposição calculado vs oferta compra
- Status atual no funil Lucas (3 caminhos)
- Dias aguardando devolução
- **Alerta revenda ilegal** se MAC ativo em outro provedor (Consulta ISP detecta)
- Botões: notificação formal | pequenas causas | arquivar equipamento

### Card 8 — COMPLIANCE EX-CLIENTE (flags especiais)

Flags que aparecem aqui mas não em cliente ativo:
- **Prescrição CC 206**: anos até prescrição, alerta 60 meses antes
- **Falecido**: validar inventário antes de cobrar
- **Boleto falso circulando**: cliente reportou fraude
- **Termo comodato válido**: assinatura confere, valor coerente
- **Vulnerável suspeita confirmar dispensa**: humano decide se dispensa cobrança ou prossegue

### Card 9 — PRÓXIMAS AÇÕES (Daniel + Lucas coordenados)

Recomendações priorizadas pelo Score & Decisão considerando AMBOS os fluxos:
- Daniel: aguardar/negativar/protestar/ceder
- Lucas: notificar/cobrar equipamento/pequenas causas
- Coordenados (ex: somar dívida equipamento à negativação D+30 Lucas)

### Card 10 — LOOP CONSULTA ISP (MOAT)

Card específico que evidencia o valor estratégico:
- Evento a ser registrado (inadimplencia_confirmada)
- Quando será registrado
- Impacto previsto na rede (score cai, outros provedores se protegem)
- "Este é o moat principal do Provedor.AI"

### Card 11 — POTENCIAL RECONQUISTA

Avaliação se vale a pena tentar reconquistar:
- Score de reconquista (0-1)
- Classificação (alta/média/baixa)
- Razões (cancelou por inadimplência, sentiment péssimo, etc)
- **Estratégia recomendada**: passiva/ativa/proibida
- Ofertas proibidas neste momento (não fazer marketing agora)

### Card 12 — TIMELINE 5 ESTÁGIOS

Visualização horizontal do funil pós-cancelamento:
- D+60-D+75: amigável (3 contatos com desconto progressivo)
- D+76-D+90: anuência prévia (notificação tripla)
- D+91-D+120: negativação SPC/Serasa
- D+121-D+180: protesto cartório (condicional)
- D+180+: cessão assessoria (última opção)

**Paralelo**: Timeline do Lucas (Dia 0, 3, 7, 15, 30, 60).

### Card 13 — AUDIT JÚLIA EX-CLIENTE

Decisões da Júlia específicas deste cliente, com foco em:
- Validação Súmula 359 STJ (10 dias úteis anuência)
- Bloqueios por vulnerabilidade suspeita
- Validações Lei 14.181 (superendividamento)

---

## 6. Endpoints REST específicos

```
GET    /api/customers/:id/recuperacao              → JSON completo (este doc)
GET    /api/customers/:id/recuperacao/estagios     → timeline 5 estágios
GET    /api/customers/:id/recuperacao/equipamentos → status equipamentos Lucas
GET    /api/customers/:id/recuperacao/roi          → recálculo ROI atual
GET    /api/customers/:id/recuperacao/historico    → tentativas feitas

POST   /api/customers/:id/recuperacao/iniciar      → marca início recuperação D+60
POST   /api/customers/:id/recuperacao/oferta-amigavel → estágio 1, desconto X%
POST   /api/customers/:id/recuperacao/anuencia-previa → estágio 2, CDC 43§2
POST   /api/customers/:id/recuperacao/negativar    → estágio 3, Júlia gate
POST   /api/customers/:id/recuperacao/protesto     → estágio 4, condicional
POST   /api/customers/:id/recuperacao/cessao       → estágio 5, último recurso
POST   /api/customers/:id/recuperacao/baixar       → após pagamento, 5 dias úteis OBRIGATÓRIO
POST   /api/customers/:id/recuperacao/arquivar     → ROI<0.3, fundamentação econômica

POST   /api/customers/:id/equipamentos/agendar-coleta → Lucas, motoboy
POST   /api/customers/:id/equipamentos/oferta-compra  → 70% valor declarado
POST   /api/customers/:id/equipamentos/oferta-downsell → -10% no dia 7
POST   /api/customers/:id/equipamentos/notificacao-d15 → cobrança formal
POST   /api/customers/:id/equipamentos/cobrar-perdido  → soma a Daniel D+30
POST   /api/customers/:id/equipamentos/pequenas-causas → escala humano jurídico
POST   /api/customers/:id/equipamentos/renunciar       → arquivar equipamento

POST   /api/customers/:id/recuperacao/confirmar-vulneravel → Lei 14.181, dispensa
POST   /api/customers/:id/recuperacao/confirmar-falecido   → bloqueia tudo
POST   /api/customers/:id/recuperacao/marcar-fraude-boleto → cliente vítima de fraude
```

---

## 7. Workflow de Daniel (D+60 a D+180+)

### Estágio 1 — D+60 a D+75 (Amigável)

```
D+60: 1º contato
  Canal: WhatsApp + SMS
  Template AUTHENTICATION (categoria Meta correta — fora janela 24h)
  Oferta: desconto 10% à vista
  Tom: "Vamos resolver isso juntos. Acordo sem novo prazo."

D+68: 2º contato
  Mesmo canal
  Oferta: desconto 20% à vista OU parcelamento 6x sem juros
  Tom: "Última oportunidade amigável."

D+74: 3º contato (último amigável)
  Canal tripla (WhatsApp + SMS + email)
  Oferta: desconto 30% à vista OU 6x sem juros
  Tom: "Próximo passo é notificação formal."
```

### Estágio 2 — D+76 a D+90 (Pré-negativação CDC 43 §2)

```
D+76: ANUÊNCIA PRÉVIA (obrigatória legal)
  Canal: tripla com PROVA DE ENTREGA (WhatsApp lido + SMS + email aberto)
  Conteúdo: texto técnico-jurídico citando CDC 43 §2 + Súmula 359 STJ
  Prazo: 10 dias úteis (calculado via calendario-br MCP)
  Botão: [Regularizar] [Negociar] [Comprovante já paguei]
  Registrar: data_envio_anuencia + comprovacao_entrega
```

### Estágio 3 — D+91 a D+120 (Negativação ativa)

```
D+91+: julia.validar_pre_negativacao()
  Se PERMITIDO:
    bureaus.incluir_negativacao(bureau: "todos")
    consulta_isp.registrar_evento(tipo: "inadimplencia_confirmada", valor, data)
  Se BLOQUEADO:
    motivos possíveis:
      - prazo Súmula 359 não cumprido
      - cliente flag vulneravel
      - dívida prescrita CC 206
      - cliente alegou pagamento <5 dias úteis (Súmula 548)
      - cliente flag binding (Procon)
      - valor <R$ 50 (boa prática)

Contato mensal mantendo informação:
  D+91: "Conforme aviso, seu nome foi incluído no SPC/Serasa."
  D+105: "Para 'limpa nome' e exclusão em 5 dias úteis: [link acordo]"
  D+120: avaliar estágio 4
```

### Estágio 4 — D+121 a D+180 (Protesto)

```
Condicionais para protesto:
  - dívida > R$ 200 (ROI positivo)
  - sem disputa judicial em curso
  - termo de contrato fundamentado
  - cliente não-vulnerável
  - Júlia OK

Se protestar:
  bureaus.enviar_protesto(cartorio, fatura, valor)
  Comunicar cliente: "protesto é cobrança formal, não desabono pessoal"
  Custo: ~R$ 50/cartório
```

### Estágio 5 — D+180+ (Cessão ou Arquivar)

```
Avaliar ROI final:
  - Se ROI > 1: cessão a assessoria especializada
    desconto até 60% aceitável
    Daniel fecha o caso após cessão
  - Se ROI < 1: ARQUIVAR
    Marcos comunica owner com fundamentação econômica
    Caso fica em "arquivado_roi_negativo" até prescrição (5 anos)
```

---

## 8. Workflow do Lucas (Equipamentos)

### Dia 0 (cancelamento) — Comunicação inicial

```
Mensagem dispara em até 2h pós-cancelamento.
Reconhecer saída ("entendemos sua decisão").
Listar TODOS os equipamentos comodato com fotos.

3 caminhos COM IGUAL DESTAQUE (foot-in-the-door):

  📦 OPÇÃO A — DEVOLUÇÃO GRATUITA (recomendada)
     "Agendamos coleta no seu endereço, sem custo.
     Você só separa o equipamento. Quando agendar?"

  💰 OPÇÃO B — COMPRA DO EQUIPAMENTO
     "Quer ficar com o roteador? Por R$ [70% valor declarado], ele é seu.
     Pix instantâneo."

  ⚠️ OPÇÃO C — NÃO DEVOLVER
     "Caso você opte por não devolver, R$ [valor cheio] será cobrado conforme
     termo de comodato assinado. Pode parcelar até 3x."

CTA: responder com A, B ou C (interactive_buttons WhatsApp)
```

### Dia 3 (sem resposta)

```
Reforço com tom mais firme.
3 opções mantidas, mas destacar prazo se aproximando.
Mostrar mapa: "Nossa equipe está fazendo coletas no seu bairro na quinta."
```

### Dia 7 (sem resposta)

```
ÚLTIMA oportunidade amigável.
DOWNSELL: -10% adicional na compra.
Ofertar coleta noturna ou sábado.
Mencionar que próximo passo é cobrança formal.
```

### Dia 15 (sem resposta)

```
NOTIFICAÇÃO FORMAL TRIPLA:
"Conforme termo de comodato assinado em [data], o valor de R$ [cheio]
será cobrado a partir de [data+15]."
Boleto enviado.

VERIFICAR: MAC ativo em outro provedor? Se sim, registrar evidência de
possível revenda ilegal (Consulta ISP).
```

### Dia 30 (sem resposta nem pagamento)

```
Repassa Daniel: dívida equipamento SOMA à negativação SPC/Serasa.
Daniel inclui valor total = financeiro + equipamento perdido.

Se MAC ativo em outro provedor:
  evidência adicional para pequenas causas se for o caso
  registrar no Consulta ISP com tipo "revenda_ilegal_suspeita"
```

### Dia 60 (avaliar pequenas causas)

```
Critérios:
  - valor equipamento > R$ 500
  - cliente identificado (endereço válido)
  - termo comodato bem fundamentado
  - sem disputa em curso

Decisão executiva → escalar humano jurídico.
Juizado Especial até 40 SM (R$ 56k).
```

---

## 9. Casos especiais

### Cliente faleceu

- Bloqueia COMPLETAMENTE cobrança
- Aguardar inventário (família avisa ou cron detecta via Receita Federal)
- Quando inventário aberto, cobrança vai aos herdeiros via humano jurídico
- NUNCA cobrar familiar diretamente (CDC art. 71)

### Cliente vulnerável confirmado (Lei 14.181)

- Operador humano confirma via flag manual + justificativa
- Júlia bloqueia TODAS as ações restritivas (negativar, protestar, ceder)
- Marcos comunica owner: "Cliente em situação de vulnerabilidade. Recomendamos dispensar cobrança e arquivar caso."
- Owner decide: dispensar (audit log) ou prosseguir manualmente (própria responsabilidade)

### Procon ativo

- Júlia FLAG binding instantânea
- Bloqueia Daniel + Lucas + qualquer outbound
- Marcos URGENT → owner + advogado humano
- Aguardar resolução Procon antes de retomar

### Dívida prescrita (>5 anos CC 206 §5 I)

- Cron diário marca clientes com prescrição
- 60 dias antes da prescrição: Marcos sugere ação preventiva (acordo final)
- Após prescrição: BLOQUEIA toda cobrança ativa
- Cliente pode pagar voluntariamente, mas Daniel NÃO força (CDC 71 = crime)

### Reconquista bem-sucedida (cliente volta)

- Cliente entra em contato querendo voltar
- Daniel para qualquer cobrança ativa
- Helena assume relacionamento novo
- Condições: Pix instalação + 3 mensalidades upfront + plano básico
- Monitoramento intensivo 90 dias
- Score Consulta ISP precisa ter melhorado (pago acordo)

### Equipamento já devolvido (cliente alega)

- Validar com estoque ERP imediatamente
- Se confirmado em estoque: Lucas fecha caso, comunicar agradecimento
- Se não em estoque: pedir comprovante (foto da etiqueta, recibo de Correios)
- Se sem comprovante: tratar como ainda em comodato

### Equipamento "foi roubado"

- Pedir BO (boletim de ocorrência) como evidência
- Se BO válido: dispensar cobrança equipamento
- Se sem BO: tratar como não devolvido
- Cuidado com fraude (cliente alega roubo pra ficar com equipamento)

### Boleto falso circulando (fraude)

- Cliente reporta que recebeu boleto falso "Provedor X"
- Marcar flag fraude no caso
- Marcos comunica owner para alerta geral aos clientes
- Verificar se há golpistas usando dados vazados
- Pode justificar dispensa de juros ao cliente vítima

---

## 10. Métricas de sucesso

### KPIs do Daniel (Recuperação Financeira)

- Taxa recuperação D+60 a D+90: ≥ 25%
- Taxa recuperação D+60 a D+180: ≥ 40%
- Custo médio por R$ recuperado: ≤ R$ 0,15
- 100% decisões com fundamentação econômica
- 0 violações Súmula 548 (baixa em 5 dias úteis)
- 0 violações Súmula 359 (negativar sem 10 dias úteis)
- 0 cobrança de dívida prescrita

### KPIs do Lucas (Equipamentos)

- Devolução voluntária: ≥ 50% (vs 15-25% mercado)
- Downsell venda: ≥ 20%
- Cobrança bem-sucedida: ≥ 30%
- Recuperação total valor: ≥ 75%
- Custo médio recuperação: ≤ R$ 30
- 0 cobrança valor > mercado (CDC 39 V)

### KPIs sistêmicos

- ROI médio recuperação: ≥ 1.5×
- % casos arquivados com fundamentação econômica: 100%
- % loops detectados e arquivados: 100%
- Eventos registrados no Consulta ISP: 100% das negativações
- Score ConsultaISP do ex-cliente cai conforme esperado pós-negativação
- 0 reclamações Procon por recuperação

---

## 11. Anti-padrões da recuperação pós-cancelamento

❌ **Tratar ex-cliente como criminoso.** Ele cancelou contrato (direito legal). Tom = cordial firme, não "vamos te pegar".

❌ **Cobrança ostensiva diária.** Máximo 1x/semana mesmo canal (CDC 42). Cliente irritado = Procon = multa.

❌ **Ameaçar judicialização sem ação real.** "Vamos te processar!" é prática vexatória CDC 71 (crime).

❌ **Negativar antes de 10 dias úteis Súmula 359.** Indenização certa em 1ª instância.

❌ **Não baixar em 5 dias úteis após pagamento.** Súmula 548 + Lei 12.039 = R$ 5-10k por caso.

❌ **Cobrar dívida prescrita.** CDC 71 = crime (detenção 3m-1a).

❌ **Cobrar valor de equipamento > mercado.** CDC 39 V = vantagem excessiva.

❌ **Ignorar sinal vulnerável.** Lei 14.181 protege. Confirmar e dispensar OU prosseguir com humano.

❌ **Spam de promoções "vem voltar".** Cliente irritado não responde a marketing. Aguardar 6-12 meses passivo.

❌ **Continuar cobrando se ROI < 0.3.** Joga dinheiro fora. Arquivar é decisão econômica racional.

❌ **Não registrar evento Consulta ISP.** Perde o moat principal do produto.

❌ **Cobrar familiares de falecido.** CDC 42 + bom senso. Aguardar inventário.

❌ **Enviar a parente, vizinho ou empregador.** CDC explícito proíbe.

---

## 12. Diagrama de fluxo (Daniel + Lucas coordenados)

```
                CANCELAMENTO (D+0 pós-rescisão)
                            │
                ┌───────────┴────────────┐
                │                        │
                ▼                        ▼
          DANIEL ($)              LUCAS (equipamento)
                │                        │
   ┌────────────┴────────────┐           │
   │                         │           │
   ▼                         ▼           ▼
D+60-D+75               D+0-D+3-D+7   Dia 0-3-7
amigável                3 caminhos    downsell
3 ofertas               + reforço     -10%
   │                         │           │
   ▼                         ▼           ▼
D+76-D+90              Dia 15         Dia 15
anuência                notificação    notificação
prévia                  formal         formal
CDC 43§2                                tripla
   │                         │           │
   ▼                         └───────────┤
D+91-D+120                               │
NEGATIVAÇÃO ◄────────────  SOMA dívida ──┘
SPC/Serasa                 equipamento
+ Consulta ISP             à negativação
   │
   ▼
D+121-D+180
Protesto cartório (condicional)
   │
   ▼
D+180+
Cessão OU arquivar

PARALELO: Dia 60 Lucas → pequenas causas (escalar humano)
                        se valor >R$ 500 + termo bem fundamentado
```

---

## 13. Próximas decisões

1. **Validar workflow legal** com advogado de telecom antes de produção (priorizar Daniel — risco maior)
2. **Treinar modelos ML específicos** ex-cliente (datasets diferentes de cliente ativo)
3. **Spec componentes UI** específicos: PostMortemCard, RoiCard, EstagioRecuperacaoTimeline
4. **Implementar Consulta ISP loop** completo (registrar evento é crítico)
5. **Workflow de arquivamento**: como Marcos comunica ao owner que vamos parar de cobrar
6. **Dashboard executivo** mostrando recuperação total mensal vs custo

---

*Cliente 360° Recuperação Pós-Cancelamento v1.0 — Maio/2026. Pareado com
CLIENTE_360.md (schema), CLIENTE_360_COBRANCA.md (cliente ativo), e
skills/provedor-recuperacao-financeira + skills/provedor-roteirizacao-logistica.*
