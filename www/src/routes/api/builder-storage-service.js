"use strict";

const crypto = require("node:crypto");
const gql = require("graphql");
const {withTransaction} = require("./database");
const {createBuilderProfileRepository} = require("./builder-profile-repository");
const {
    renameValidatedBuilderProfile,
    validateBuilderProfile
} = require("./builder-payload");
const {
    BadRequestError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError
} = require("./utils");

const QUOTA_BYTES = 10_485_760;

function forbidden() {
    return new gql.GraphQLError("A verified account is required.", {
        extensions: {code: 403}
    });
}

function requireVerifiedMember(auth) {
    if (auth?.emailVerified !== true || !Number.isSafeInteger(auth?.memberId))
        throw forbidden();
    return auth.memberId;
}

function requireObject(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new BadRequestError("Invalid storage request.");
}

function requirePositiveInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 1)
        throw new BadRequestError(`A valid ${field} is required.`);
    return value;
}

function requireGeneration(input) {
    return requirePositiveInteger(input.storageGeneration, "storage generation");
}

function assertGeneration(preferences, expected) {
    if (preferences.storageGeneration !== expected)
        throw new ConflictError("Account storage changed. Reload before saving.");
}

function assertWithinQuota(usedBytes) {
    if (usedBytes > QUOTA_BYTES)
        throw new PayloadTooLargeError("Builder account storage is limited to 10 MB.");
}

function savedProfile(memberId, id, validated, revision, createdOn, updatedOn) {
    return {
        memberId,
        id,
        name: validated.name,
        payload: validated.payload,
        payloadVersion: validated.payloadVersion,
        payloadBytes: validated.byteLength,
        revision,
        createdOn,
        updatedOn,
        deletedOn: null
    };
}

function publicProfile(profile) {
    if (!profile)
        return null;
    const {memberId, ...result} = profile;
    return result;
}

function resultState({status, profile, conflictProfile, preferences, usedBytes}) {
    const result = {
        status,
        storageGeneration: preferences.storageGeneration,
        usedBytes,
        quotaBytes: QUOTA_BYTES
    };
    if (profile)
        result.profile = publicProfile(profile);
    if (conflictProfile)
        result.conflictProfile = publicProfile(conflictProfile);
    return result;
}

function nextConflictName(name, profiles) {
    const activeNames = new Set(profiles.map(profile => profile.name));
    let candidate = `${name} Conflict`;
    let suffix = 2;
    while (activeNames.has(candidate)) {
        candidate = `${name} Conflict ${suffix}`;
        suffix += 1;
    }
    return candidate;
}

async function validateStorageProfile(validateProfile, input) {
    try {
        return await validateProfile(input);
    }
    catch (error) {
        if (error?.extensions?.code)
            throw error;
        throw new BadRequestError("The Builder profile is invalid.");
    }
}

async function runStorageTransaction(pool, operation) {
    try {
        return await withTransaction(pool, operation);
    }
    catch (error) {
        if (error?.extensions?.code)
            throw error;
        throw new gql.GraphQLError("The request could not be completed.");
    }
}

function createBuilderStorageService({
    pool,
    repository = createBuilderProfileRepository({pool}),
    validateProfile = validateBuilderProfile,
    renameProfile = renameValidatedBuilderProfile,
    clock = () => new Date(),
    randomUUID = crypto.randomUUID
}) {
    if (!pool)
        throw new TypeError("A database pool is required.");

    async function readState(auth) {
        const memberId = requireVerifiedMember(auth);
        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const preferences = await repository.readPreferencesForUpdate(memberId, options);
            if (!preferences)
                throw new Error("Account storage state could not be initialized.");
            const profiles = await repository.list(memberId, options);
            const usedBytes = await repository.usedBytes(memberId, options);
            return {
                profiles: profiles.map(publicProfile),
                preferences,
                storageGeneration: preferences.storageGeneration,
                usedBytes,
                quotaBytes: QUOTA_BYTES
            };
        });
    }

    async function exportAll(auth) {
        requireVerifiedMember(auth);
        return readState(auth);
    }

    async function createProfile(auth, input) {
        const memberId = requireVerifiedMember(auth);
        requireObject(input);
        const expectedGeneration = requireGeneration(input);
        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const preferences = await repository.readPreferencesForUpdate(memberId, options);
            assertGeneration(preferences, expectedGeneration);
            const validated = await validateStorageProfile(validateProfile, {
                name: input.name,
                payload: input.payload
            });
            const profiles = await repository.list(memberId, options);
            if (profiles.some(profile => profile.name === validated.name))
                throw new ConflictError("An active profile already uses that name.");
            const usedBytes = await repository.usedBytes(memberId, options);
            assertWithinQuota(usedBytes + validated.byteLength);
            const now = clock();
            const stored = savedProfile(
                memberId, randomUUID(), validated, 1, now, now
            );
            await repository.insert(stored, options);
            return resultState({
                status: "saved",
                profile: stored,
                preferences,
                usedBytes: usedBytes + validated.byteLength
            });
        });
    }

    async function updateProfile(auth, input) {
        const memberId = requireVerifiedMember(auth);
        requireObject(input);
        const expectedGeneration = requireGeneration(input);
        const expectedRevision = requirePositiveInteger(input.revision, "profile revision");
        if (typeof input.id !== "string" || !input.id)
            throw new BadRequestError("A profile ID is required.");

        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const preferences = await repository.readPreferencesForUpdate(memberId, options);
            assertGeneration(preferences, expectedGeneration);
            const current = await repository.findByPublicIdForUpdate(
                memberId, input.id, options
            );
            if (!current)
                throw new NotFoundError("Profile not found.");
            const validated = await validateStorageProfile(validateProfile, {
                name: input.name,
                payload: input.payload
            });
            const usedBytes = await repository.usedBytes(memberId, options);

            if (!current.deletedOn && current.revision === expectedRevision) {
                const profiles = await repository.list(memberId, options);
                if (profiles.some(profile =>
                    profile.id !== current.id && profile.name === validated.name)) {
                    throw new ConflictError("An active profile already uses that name.");
                }
                const nextUsedBytes = usedBytes - current.payloadBytes + validated.byteLength;
                assertWithinQuota(nextUsedBytes);
                const updated = savedProfile(
                    memberId,
                    current.id,
                    validated,
                    current.revision + 1,
                    current.createdOn,
                    clock()
                );
                const affected = await repository.update(memberId, current.id, updated, {
                    ...options,
                    expectedRevision
                });
                if (affected !== 1)
                    throw new ConflictError("Profile changed before it could be saved.");
                return resultState({
                    status: "saved",
                    profile: updated,
                    preferences,
                    usedBytes: nextUsedBytes
                });
            }

            const profiles = await repository.list(memberId, options);
            const conflictName = nextConflictName(validated.name, profiles);
            const renamed = await validateStorageProfile(
                input => renameProfile(validated, input.name),
                {name: conflictName}
            );
            assertWithinQuota(usedBytes + renamed.byteLength);
            const now = clock();
            const conflict = savedProfile(
                memberId,
                randomUUID(),
                renamed,
                1,
                now,
                now
            );
            await repository.insert(conflict, options);
            return resultState({
                status: "conflict",
                profile: current,
                conflictProfile: conflict,
                preferences,
                usedBytes: usedBytes + renamed.byteLength
            });
        });
    }

    async function deleteProfile(auth, input) {
        const memberId = requireVerifiedMember(auth);
        requireObject(input);
        const expectedGeneration = requireGeneration(input);
        const expectedRevision = requirePositiveInteger(input.revision, "profile revision");
        if (typeof input.id !== "string" || !input.id)
            throw new BadRequestError("A profile ID is required.");

        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const preferences = await repository.readPreferencesForUpdate(memberId, options);
            assertGeneration(preferences, expectedGeneration);
            const current = await repository.findByPublicIdForUpdate(
                memberId, input.id, options
            );
            if (!current)
                throw new NotFoundError("Profile not found.");
            if (current.deletedOn || current.revision !== expectedRevision)
                throw new ConflictError("Profile changed before it could be deleted.");
            const deletedOn = clock();
            const affected = await repository.markDeleted(memberId, current.id, {
                expectedRevision,
                deletedOn
            }, options);
            if (affected !== 1)
                throw new ConflictError("Profile changed before it could be deleted.");
            const tombstone = {
                ...current,
                payload: null,
                payloadVersion: null,
                payloadBytes: 0,
                revision: current.revision + 1,
                updatedOn: deletedOn,
                deletedOn
            };
            const usedBytes = await repository.usedBytes(memberId, options);
            return resultState({
                status: "deleted",
                profile: tombstone,
                preferences,
                usedBytes
            });
        });
    }

    async function updatePreferences(auth, input) {
        const memberId = requireVerifiedMember(auth);
        requireObject(input);
        const expectedGeneration = requireGeneration(input);
        if (!Object.hasOwn(input, "payload"))
            throw new BadRequestError("A preference payload is required.");

        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const current = await repository.readPreferencesForUpdate(memberId, options);
            assertGeneration(current, expectedGeneration);
            try {
                JSON.stringify(input.payload);
            }
            catch {
                throw new BadRequestError("The preference payload is invalid.");
            }
            const preferences = {
                documentVersion: Number.isSafeInteger(input.documentVersion)
                    ? input.documentVersion
                    : 1,
                payload: input.payload,
                revision: current.revision + 1,
                storageGeneration: current.storageGeneration,
                updatedOn: clock()
            };
            await repository.writePreferences(memberId, preferences, options);
            const usedBytes = await repository.usedBytes(memberId, options);
            return {
                status: "saved",
                preferences,
                storageGeneration: preferences.storageGeneration,
                usedBytes,
                quotaBytes: QUOTA_BYTES
            };
        });
    }

    async function deleteAll(auth, input) {
        const memberId = requireVerifiedMember(auth);
        requireObject(input);
        const expectedGeneration = requireGeneration(input);
        return runStorageTransaction(pool, async function(connection) {
            const options = {executor: connection};
            const current = await repository.readPreferencesForUpdate(memberId, options);
            assertGeneration(current, expectedGeneration);
            const profiles = await repository.list(memberId, options);
            const deletedOn = clock();
            for (const profile of profiles) {
                const affected = await repository.markDeleted(memberId, profile.id, {
                    expectedRevision: profile.revision,
                    deletedOn
                }, options);
                if (affected !== 1)
                    throw new ConflictError("Account storage changed before deletion completed.");
            }
            const preferences = {
                ...current,
                revision: current.revision + 1,
                storageGeneration: current.storageGeneration + 1,
                updatedOn: deletedOn
            };
            await repository.writePreferences(memberId, preferences, options);
            return {
                status: "deleted",
                storageGeneration: preferences.storageGeneration,
                usedBytes: 0,
                quotaBytes: QUOTA_BYTES
            };
        });
    }

    return {
        readState,
        exportAll,
        createProfile,
        updateProfile,
        deleteProfile,
        updatePreferences,
        deleteAll
    };
}

module.exports = {createBuilderStorageService, QUOTA_BYTES};
