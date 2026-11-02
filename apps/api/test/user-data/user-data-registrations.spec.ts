// Vault's registrations on the user-data slice (issue #91, E9.3): the categories, the one narrow scope,
// one decision per owner model, the delegate type and the factory reset steps, as the app registers them.

import '../../src/app-registrations/registrations';
import '../../src/platform/user-data/user-data.manifest';

import {
  categoriesOfScope,
  factoryResetStepRegistry,
  findUserDataScope,
  userDataCategoryRegistry,
  userDataModelRegistry,
  storageObjectModelHint,
} from '@marinoscar/platform-api/user-data';
import { userOwnedModelRegistry } from '@marinoscar/platform-api/core';

import { VaultUserDataPurgeHandler } from '../../src/platform/user-data/vault-user-data-purge.handler';

describe('Vault user-data registrations', () => {
  it('registers the four Vault categories, all content, ahead of the platform\'s', () => {
    const ids = userDataCategoryRegistry.list().map((category) => category.id);
    expect(ids.slice(0, 4).sort()).toEqual(['backups', 'media', 'secretTypes', 'secrets']);
    for (const id of ['secrets', 'secretTypes', 'media', 'backups']) {
      expect(userDataCategoryRegistry.get(id)?.content).toBe(true);
    }
    expect(ids).toEqual(expect.arrayContaining(['files', 'notifications', 'ai', 'credentials', 'settings', 'other']));
  });

  it('adds one narrow scope, `backups`, with its own confirmation phrase, and leaves the built-in two alone', () => {
    const scope = findUserDataScope('backups');
    expect(scope).toMatchObject({ layer: 'specific', confirmation: 'DELETE MY BACKUPS' });
    expect(categoriesOfScope(scope!)).toEqual(['backups']);
    expect(findUserDataScope('everything')?.confirmation).toBe('DELETE MY DATA');
    expect(findUserDataScope('content')?.confirmation).toBe('DELETE MY CONTENT');
  });

  it('decides every owner model: secrets, media folders, backups and custom types are deleted, the schedule is kept', () => {
    const decision = (model: string) => userDataModelRegistry.get(model);
    expect(decision('Secret')).toMatchObject({ category: 'secrets' });
    expect(decision('MediaFolder')).toMatchObject({ category: 'media' });
    expect(decision('BackupRun')).toMatchObject({ category: 'backups', delegate: { jobType: 'vault.user_data.purge' } });
    expect(decision('SecretType')).toMatchObject({ category: 'secretTypes', delegate: { jobType: 'vault.user_data.purge' } });
    expect(decision('BackupSchedule')?.keep).toBeTruthy();

    const owners = userOwnedModelRegistry.list().filter((def) => def.ownerField !== undefined);
    const undecided = owners.filter((def) => userDataModelRegistry.get(def.model) === undefined).map((def) => def.model);
    expect(undecided).toEqual([]);
  });

  it('runs the platform\'s `files` category over EVERY object a user uploaded (attachments, card faces and media files)', () => {
    expect(storageObjectModelHint()).toMatchObject({ model: 'StorageObject', category: 'files', storageObjects: true });
  });

  it('hands the delegate only a user id', () => {
    const delegate = userDataModelRegistry.get('BackupRun')?.delegate;
    expect(delegate?.payload('user-1')).toEqual({ userId: 'user-1' });
  });

  it('pins the delegate\'s type string to the handler that registers under it', () => {
    const handler = new VaultUserDataPurgeHandler({ register: jest.fn() } as never, {} as never, {} as never);
    expect(handler.type).toBe(userDataModelRegistry.get('BackupRun')?.delegate?.jobType);
  });

  it('registers the two factory reset steps in the phases that keep the archives reachable', () => {
    const steps = Object.fromEntries(factoryResetStepRegistry.list().map((step) => [step.id, step]));
    // Before the users go: the user rows\' cascade would delete the run rows and strand their archives.
    expect(steps['vault.backups']).toMatchObject({ phase: 'before-users' });
    // After the orphan sweep, once no secret uses a type: system types have a null author and must survive it.
    expect(steps['vault.secret-types']).toMatchObject({ phase: 'deployment' });
  });

  it('never deletes system secret types in the factory reset step', async () => {
    const step = factoryResetStepRegistry.get('vault.secret-types')!;
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    await expect(step.run({ secretType: { deleteMany } }, { actorUserId: 'a', jobId: 'j' })).resolves.toEqual({ customSecretTypes: 3 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { isSystem: false } });
  });
});
