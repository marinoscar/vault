// Host Beta's test environment. Test-only values; never a real key.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'hostbeta-test-jwt-secret-not-a-real-one';
// The platform identity slice builds its Google strategy at boot; placeholders, never used.
process.env.GOOGLE_CLIENT_ID = 'hostbeta-test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'hostbeta-test-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'https://host.example.test/api/auth/google/callback';
// The queue does not poll in the tests: nothing here waits for a job.
process.env.JOBS_WORKER_MODE = 'off';
process.env.INITIAL_ADMIN_EMAIL = 'first-admin@host.example.test';
// The host's OWN data key ring (`kid:base64`, 32 bytes each). Deliberately not VAULT_ENCRYPTION_KEY,
// which this process must not have.
process.env.HOST_BETA_DATA_KEYS = `k1:${Buffer.alloc(32, 7).toString('base64')}`;
delete process.env.VAULT_ENCRYPTION_KEY;
