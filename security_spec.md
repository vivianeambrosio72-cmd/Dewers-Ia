# Dewers IA — Especificação de Segurança Firestore

## 1. Invariantes de Dados

1. **Isolamento de PII (`/users/{userId}`)**: Nenhum usuário pode ler, listar ou alterar o perfil de outro usuário. `list` é proibido na coleção `/users`. O campo `uid` no documento deve corresponder exatamente a `userId` e `request.auth.uid`.
2. **Propriedade Estrita (`/projects/{projectId}`)**: Um projeto só pode ser criado se `ownerId == request.auth.uid` e `id == projectId`. Listagens (`allow list`) exigem `resource.data.ownerId == request.auth.uid`, impedindo raspagem de projetos alheios.
3. **Imutabilidade e Integridade Temporal**: `ownerId`, `id`, `uid` e `createdAt` são imutáveis após a criação. `createdAt` na criação e `updatedAt` na atualização devem ser estritamente iguais a `request.time`.
4. **Limites Volumétricos**: Todas as strings, mapas e arrays possuem limites máximos explícitos para prevenir ataques de exaustão de recursos e rejeitar campos extras (`hasOnly`).
5. **E-mail Verificado**: Todas as operações de escrita exigem `request.auth.token.email_verified == true`.

## 2. "Dirty Dozen" Payloads (Vetores de Ataque Bloqueados)

1. **Escrita não autenticada em `/projects/proj_1`**: `request.auth == null` -> `PERMISSION_DENIED`.
2. **E-mail não verificado**: `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
3. **Spoofing de `ownerId` na criação**: Usuário `alice` tenta criar projeto com `ownerId: "bob"` -> `PERMISSION_DENIED`.
4. **ID Poisoning no path**: Criação em `/projects/invalid$id!with*badchars` ou string > 128 chars -> `PERMISSION_DENIED`.
5. **Shadow Field Injection (Ghost Field)**: Payload de criação ou atualização inclui `{ isAdmin: true }` ou `{ role: "admin" }` -> bloqueado por `hasOnly(...)` e `affectedKeys().hasOnly(...)` -> `PERMISSION_DENIED`.
6. **Timestamp Spoofing**: Cliente envia `createdAt: new Date('2020-01-01')` em vez de `serverTimestamp()` -> bloqueado por `== request.time` -> `PERMISSION_DENIED`.
7. **Transferência ilícita de propriedade em Update**: Usuário tenta alterar `ownerId` ou `createdAt` no `updateDoc` -> `PERMISSION_DENIED`.
8. **Listagem global sem filtro (`/projects`)**: Usuário tenta listar todos os projetos sem `where('ownerId', '==', uid)` -> bloqueado por `resource.data.ownerId == request.auth.uid` -> `PERMISSION_DENIED`.
9. **Leitura de PII de terceiros (`/users/bob`)**: Usuário `alice` tenta `get` em `/users/bob` -> `PERMISSION_DENIED`.
10. **Listagem da coleção `/users`**: Qualquer usuário tenta `list` em `/users` -> `PERMISSION_DENIED`.
11. **Value Poisoning em `language`**: Payload tenta gravar `language: "xx-INVALID"` fora da lista permitida -> `PERMISSION_DENIED`.
12. **Array/String Exhaustion**: Payload tenta gravar `title` com 5000 caracteres ou `segments` com > 300 itens -> `PERMISSION_DENIED`.
