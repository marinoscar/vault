# App schema fragments

This folder holds Vault's own Prisma models. `vault.prisma` owns the secrets, media-folder and backup models plus the back-relations (`extend model User`, `extend model StorageObject`); `media-folder-files.prisma` owns the link between a media folder and a storage object. The platform's models come from `@marinoscar/platform-db` (`node_modules/@marinoscar/platform-db/schema/`).

`prisma/schema/` is **generated** from the platform fragments plus the `*.prisma` files in this folder by `npm run db:compose`, and committed. Never edit a file there: `npm run db:compose:check` (CI) fails when it differs from a fresh compose.

## Adding a model that points at a platform model

Write the model and, in the same file, an `extend model` block that declares the back-relation. Prisma requires the field on both sides, and it cannot extend a model across files, so this block is how an app adds the platform model's side without editing a platform file:

```prisma
model Workout {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  title     String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("workouts")
}

extend model User {
  workouts Workout[]
}
```

Only a model its owner marked `// @extensible` can be extended: `User`, `Organization`, `Role`, `Job`, `Group`, `Grant`, `AiRun`, `StorageObject`, `Notification`, `NotificationDelivery` and `Credential` (`Permission` is closed on purpose; what to hang on each, and the composite keys an org-owned table needs: [platform-db README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-db/README.md#extension-point-catalog)). An `extend` block holds back-relation fields only: no scalar field, no `fields: [...]` relation, no `@@` attribute (each is a composer error with a stable code, a file and a line).

Then:

```bash
cd apps/api
npm run db:compose                           # regenerate prisma/schema/
npm run prisma:generate
npm run prisma:migrate:dev -- --name add_workouts
```

## Changing the generator or datasource

An app that needs another generator option (`output`, `previewFeatures`) adds a `base.prisma` here. It replaces the package's `base.prisma` entirely, and the composer warns that it did.

Full reference: [`packages/platform-db/README.md`](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-db/README.md) and ADR 0002 of EnterpriseAppBase (D2).
