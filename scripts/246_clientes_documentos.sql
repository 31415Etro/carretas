-- 246 — Cadastro de clientes: guarda a CNH (ou outro documento de identidade) e o comprovante de residência, em foto ou PDF.
-- Rode no SQL Editor do Supabase. ADITIVA e idempotente: só acrescenta duas colunas em clients; não altera nem apaga nada.
-- Os arquivos ficam num bucket PRIVADO (client-documents); a coluna guarda o caminho no bucket e a tela abre o arquivo por um link temporário, só para usuário logado.

alter table public.clients add column if not exists cnh_file_url text;
alter table public.clients add column if not exists residence_proof_url text;

select count(*) as clientes from public.clients;
