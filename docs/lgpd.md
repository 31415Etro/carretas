# LGPD no ERP Carretas — práticas técnicas adotadas

Este documento descreve como o sistema trata dados pessoais. É um guia técnico para a equipe, **não é parecer jurídico**: bases legais, prazos de retenção e respostas a titulares devem ser validados com o encarregado (DPO) ou assessoria jurídica da empresa.

## Dados pessoais tratados

| Titular | Dados | Onde ficam | Por quê |
|---|---|---|---|
| Clientes e fornecedores (PF) | nome, CPF, telefone, e-mail, endereço | `clients`, `suppliers` | contrato, emissão fiscal, cobrança |
| Contatos de empresas | nome, cargo, telefone, e-mail | `clients.responsible_name`, `contact_role` | relacionamento comercial |
| Usuários do sistema | nome, e-mail, telefone, cargo, departamento, último acesso | `profiles`, Supabase Auth | acesso e auditoria |
| Equipe técnica e motoristas | nome, CPF, RG, CNH, endereço, custo/hora | `providers`, `fleet_drivers` | operação, segurança de trânsito, folha de custos |
| Proprietários de veículos | nome e documento | `vehicles` | licenciamento e seguro |

Coleta mínima: os cadastros só exigem o necessário à operação (por exemplo, lead pode existir sem CPF/CNPJ até virar cliente). Campos opcionais não devem ser preenchidos "por garantia".

## Controles de acesso

- Páginas por permissão (`profiles.page_permissions`) e empresas autorizadas por usuário (`profile_companies`); administrador é o único com acesso a Configurações e Log do Sistema.
- Isolamento por empresa (CNPJ) no banco: coluna `system_company_id` e políticas RLS nas tabelas por empresa.
- Clientes externos não acessam rotas internas (bloqueio e registro na auditoria).
- Documentos com visibilidade (Todos / Administradores / Responsável).

## Proteção e minimização

- Senhas nunca são gravadas pelo sistema (Supabase Auth guarda o hash). Senha de certificado digital é cifrada com AES-256-GCM (`CONFIG_ENCRYPTION_KEY`) e nunca volta para a tela.
- Chaves de integração ficam em variáveis de ambiente do servidor.
- A trilha de auditoria (`audit_events`) mascara CPF/CNPJ/CNH/RENAVAM e nunca grava senhas, tokens ou assinaturas.
- Arquivos (documentos, anexos, comprovantes, certificados) ficam em buckets privados com URL assinada de 5 minutos.
- Exportações de dados (relatórios e auditoria) são registradas com usuário, filtros e quantidade.

## Retenção

- Auditoria: configurável por empresa em Configurações/Log do Sistema (mínimo 365 dias; padrão 5 anos); o expurgo é automático e registrado.
- Registros com histórico financeiro, fiscal ou operacional **não são apagados**: são inativados (exclusão lógica). Definir com o jurídico por quanto tempo manter e quando anonimizar dados de quem não tem mais relação com a empresa.
- Backups do banco seguem a política do provedor (Supabase): confirmar tempo de retenção.

## Direitos dos titulares (procedimento sugerido)

1. Confirmação e acesso: localizar a pessoa em Comercial (cliente/fornecedor), Configurações (usuário/equipe) e Frota (motorista); exportar os dados relacionados.
2. Correção: editar o cadastro (a alteração fica na auditoria).
3. Eliminação/anonimização: inativar o cadastro; anonimizar campos pessoais quando não houver obrigação legal de guarda (procedimento manual, a decidir com o jurídico).
4. Registrar o atendimento (data, solicitante, ação) em Documentos, com visibilidade "Administradores".

## Pendências recomendadas

- Aviso de privacidade e termos para usuários externos (clientes com acesso ao sistema).
- Rotina periódica de revisão de usuários e permissões (a lista mostra último acesso e MFA).
- Autenticação multifator obrigatória para administradores (fluxo de cadastro/desafio ainda não implementado na tela de login).
- Plano de resposta a incidentes e contato do encarregado.
