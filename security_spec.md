# Dewers IA — Especificação de Segurança Firestore e Painel Administrativo

## 1. Invariantes de Dados

1. **Administrador Exclusivo (`dewersmatari@gmail.com`)**: Apenas `request.auth.token.email == 'dewersmatari@gmail.com'` com `request.auth.token.email_verified == true` é reconhecido como administrador nas Firestore Security Rules e na verificação criptográfica do servidor (`verifyIdToken`). Nenhum outro e-mail (incluindo contas antigas ou utilizadores comuns) possui privilégios administrativos.
2. **Isolamento de PII e Anti-Escalação (`/users/{userId}`)**:
   - Utilizadores comuns só podem ler o seu próprio documento (`get`) e nunca listar `/users` (`list` exclusivo para admin).
   - Na criação de perfil por utilizadores comuns, `role` deve ser `'user'`, `plan` deve ser `'FREE'`, `subscriptionStatus` deve ser `'free'` e `billingCycle` deve ser `'none'`.
   - Em atualizações feitas por utilizadores comuns, apenas `displayName`, `photoURL`, `authProvider`, `lastActiveAt` e `updatedAt` podem ser alterados; alterações em `role`, `plan`, `subscriptionStatus`, `billingCycle` ou `subscriptionExpiresAt` retornam `PERMISSION_DENIED`.
3. **Registo Imutável de Transcrições (`/transcriptions/{transcriptionId}`)**:
   - Utilizadores comuns só podem criar registos com `userId == request.auth.uid`, `userEmail == request.auth.token.email`, `createdAt == request.time`, e `userPlan` validado contra o documento `/users/{uid}` real.
   - Utilizadores comuns só podem listar/ler os seus próprios registos; atualizações são bloqueadas exceto marcação `resolvedByAdmin` pelo admin.
4. **Pagamentos Protegidos (`/payments/{paymentId}`)**:
   - Apenas a administradora (`dewersmatari@gmail.com`) pode criar, editar ou remover pagamentos. Utilizadores comuns só podem ler os seus próprios registos.
5. **Auditoria Imutável (`/audit_logs/{logId}`)**:
   - Leitura e criação exclusivas da administradora (`dewersmatari@gmail.com`), com `adminUid == request.auth.uid`, `adminEmail == 'dewersmatari@gmail.com'` e `createdAt == request.time`. Atualizações e exclusões são sempre proibidas (`if false`).
6. **Configuração Multicaixa Express (`/settings/multicaixa_express`)**:
   - Leitura (`get`) permitida apenas a utilizadores autenticados para exibir os dados de transferência; listagem bloqueada para não-admins; criação e atualização exclusivas de `dewersmatari@gmail.com`.
7. **Pedidos PRO via Multicaixa Express + WhatsApp (`/pro_orders/{orderId}`)**:
   - Utilizadores verificados podem apenas criar os seus próprios pedidos com `status == 'PENDENTE'`, preços fixos (`1000 Kz` / `30 dias` para mensal ou `10000 Kz` / `365 dias` para anual) e sem campos de aprovação.
   - Apenas `dewersmatari@gmail.com` pode aprovar (`APROVADO`) ou rejeitar (`REJEITADO`), exclusivamente a partir do estado `PENDENTE` (impedindo aprovações duplicadas) e exigindo atualização atómica (`getAfter`) do perfil `/users/{userId}` para `PRO` ativo na aprovação.
8. **Registo Imutável de Exportações / Salvamentos (`/video_exports/{exportId}`)**:
   - Utilizadores verificados podem apenas criar registos próprios com `userId == request.auth.uid`, `userEmail == request.auth.token.email`, `createdAt == request.time`, e `userPlan` validado contra `/users/{uid}`.
   - Atualizações e exclusões são estritamente proibidas (`if false`) para impedir que utilizadores comuns apaguem o histórico e contornem o limite de 2 vídeos do plano `FREE`.

## 2. "Dirty Dozen" Payloads (Vetores de Ataque Bloqueados)

1. **Escrita não autenticada**: Qualquer acesso com `request.auth == null` -> `PERMISSION_DENIED`.
2. **E-mail spoofado sem verificação**: Token com `email: "dewersmatari@gmail.com"` e `email_verified: false` tentando ler `/users` ou `/audit_logs` -> `PERMISSION_DENIED`.
3. **Auto-promoção a admin no registo**: Utilizador comum cria `/users/{uid}` com `role: "admin"` -> `PERMISSION_DENIED`.
4. **Auto-upgrade para PRO**: Utilizador comum atualiza `/users/{uid}` tentando definir `plan: "PRO"` ou `subscriptionStatus: "active"` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: Payload inclui campo extra não autorizado (ex.: `customClaim: true`, `isAdmin: true`) -> bloqueado por `hasOnly(...)` e `affectedKeys().hasOnly(...)` -> `PERMISSION_DENIED`.
6. **Listagem global de PII (`/users`) por utilizador comum**: `getDocs(collection(db, 'users'))` com `alice@gmail.com` -> `PERMISSION_DENIED`.
7. **Criação de pagamento falso (`/payments/{id}`) por utilizador comum**: Tentativa de gravar `status: "confirmed"` -> `PERMISSION_DENIED`.
8. **Spoofing de `userPlan` em `/transcriptions`**: Utilizador `FREE` tenta enviar `userPlan: "PRO"` no log de transcrição -> rejeitado pela validação cruzada com `/users/{uid}` -> `PERMISSION_DENIED`.
9. **Spoofing de `userId` em `/transcriptions`**: Utilizador `alice` tenta registar consumo no UID `bob` -> `PERMISSION_DENIED`.
10. **Adulteração ou remoção de `/audit_logs`**: Tentativa de `update` ou `delete` mesmo por admin, ou `create` por não-admin -> `PERMISSION_DENIED`.
11. **Timestamp Spoofing**: Cliente envia `createdAt` ou `updatedAt` diferente de `request.time` -> `PERMISSION_DENIED`.
12. **ID Poisoning / Resource Exhaustion**: IDs com caracteres inválidos ou > 128 chars, ou strings acima dos limites declarados -> `PERMISSION_DENIED`.
13. **Auto-aprovação de Pedido PRO (`/pro_orders/{id}`)**: Utilizador comum cria pedido já com `status: "APROVADO"` ou tenta atualizar um pedido para `APROVADO` -> `PERMISSION_DENIED`.
14. **Adulteração de Preço/Duração em Pedido PRO**: Utilizador envia `billingCycle: "annual"` com `amountKz: 100` ou `durationDays: 9999` -> `PERMISSION_DENIED`.
15. **Aprovação Duplicada de Pedido PRO**: Admin ou script tenta aprovar novamente um pedido cujo estado já é `APROVADO` ou `REJEITADO` -> `PERMISSION_DENIED`.
16. **Alteração do Número Multicaixa por Utilizador Comum**: Utilizador não-admin tenta escrever em `/settings/multicaixa_express` -> `PERMISSION_DENIED`.
17. **Eliminação de Registo de Exportação (`/video_exports/{id}`)**: Utilizador `FREE` tenta apagar ou modificar um documento em `/video_exports` para resetar a cota de 2 vídeos -> `PERMISSION_DENIED`.
18. **Spoofing de `userId` ou `userPlan` em `/video_exports/{id}`**: Utilizador `FREE` tenta gravar `userPlan: "PRO"` ou `userId` de terceiros -> `PERMISSION_DENIED`.
